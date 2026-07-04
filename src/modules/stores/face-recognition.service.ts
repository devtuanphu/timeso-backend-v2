import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as path from 'path';
import * as fs from 'fs';

/* eslint-disable @typescript-eslint/no-require-imports */
// Gracefully load optional native AI dependencies
let faceapi: any = null;
let canvas: any = null;
let faceApiAvailable = false;

try {
  // Load native TensorFlow C++ backend FIRST (10-20x faster than pure JS)
  try {
    require('@tensorflow/tfjs-node');
  } catch {
    console.warn('⚠️ @tensorflow/tfjs-node not loaded, using slow JS backend');
  }

  // Use @vladmandic/face-api (modern fork, compatible with tfjs-node)
  faceapi = require('@vladmandic/face-api');
  canvas = require('canvas');

  // Polyfill for Node.js environment
  const { Canvas, Image, ImageData } = canvas;
  faceapi.env.monkeyPatch({ Canvas, Image, ImageData });
  faceApiAvailable = true;
} catch (err) {
  console.warn('⚠️ Face recognition dependencies not available (canvas/face-api). Face features disabled.', (err as Error)?.message);
}
/* eslint-enable @typescript-eslint/no-require-imports */

export interface FaceMatchResult {
  matched: boolean;
  distance: number;
  bestMatchIndex: number;
}

@Injectable()
export class FaceRecognitionService implements OnModuleInit {
  private readonly logger = new Logger(FaceRecognitionService.name);
  private modelsLoaded = false;

  async onModuleInit() {
    if (!faceApiAvailable) {
      this.logger.warn('Face recognition dependencies not available. Service disabled.');
      return;
    }
    await this.loadModels();
  }

  /**
   * Load face-api.js neural network models
   */
  async loadModels(): Promise<void> {
    if (this.modelsLoaded || !faceApiAvailable) return;

    const modelsPath = path.join(process.cwd(), 'models');

    if (!fs.existsSync(modelsPath)) {
      this.logger.warn(`Models directory not found at ${modelsPath}.`);
      return;
    }

    try {
      this.logger.log(`Loading face models...`);

      await faceapi.nets.ssdMobilenetv1.loadFromDisk(modelsPath);
      await faceapi.nets.faceLandmark68Net.loadFromDisk(modelsPath);
      await faceapi.nets.faceRecognitionNet.loadFromDisk(modelsPath);

      this.modelsLoaded = true;
      this.logger.log(`Face models loaded ✅`);
    } catch (error) {
      this.logger.error('Failed to load face models:', error);
    }
  }

  /**
   * Draw the source image onto a new canvas, rotated by `rotation` degrees
   * (0/90/180/270) and scaled so the longest side is <= MAX_SIZE.
   * Rotation compensates for EXIF orientation, which node-canvas does NOT
   * apply automatically — iOS `takePhoto` saves upright frames with an EXIF
   * orientation flag, so the raw pixels can be rotated 90°/180°.
   */
  private drawOriented(img: any, rotation: number, maxSize: number): any {
    let w = img.width;
    let h = img.height;
    if (w > maxSize || h > maxSize) {
      const scale = maxSize / Math.max(w, h);
      w = Math.round(w * scale);
      h = Math.round(h * scale);
    }

    // For 90/270 the output canvas swaps width/height
    const swap = rotation === 90 || rotation === 270;
    const outCanvas = canvas.createCanvas(swap ? h : w, swap ? w : h);
    const ctx = outCanvas.getContext('2d');

    ctx.translate(outCanvas.width / 2, outCanvas.height / 2);
    ctx.rotate((rotation * Math.PI) / 180);
    ctx.drawImage(img, -w / 2, -h / 2, w, h);

    return outCanvas;
  }

  /**
   * Extract 128-dim face descriptor from an image buffer.
   *
   * Robustness measures (all needed because the client captures 3 angles —
   * front/left/right — from an iOS front camera):
   *  1. Try each EXIF-compensating rotation (0/90/180/270) until a face is
   *     found. node-canvas ignores EXIF orientation, so a rotated buffer
   *     otherwise yields 0 detections even though the client saw a face.
   *  2. Use a lower SSD minConfidence so turned/profile faces (steps 2 & 3)
   *     are not dropped by the frontal-biased default (0.5).
   */
  async extractDescriptor(imageBuffer: Buffer): Promise<Float32Array | null> {
    if (!this.modelsLoaded || !faceApiAvailable) {
      this.logger.warn('Face recognition not available');
      return null;
    }

    try {
      const startTime = Date.now();
      const img = await canvas.loadImage(imageBuffer);
      const MAX_SIZE = 640;

      // Lower confidence than the 0.5 default so profile/angled faces survive
      const detectorOptions = new faceapi.SsdMobilenetv1Options({
        minConfidence: 0.3,
      });

      // EXIF-orientation is unknown here, so try each rotation until one hits.
      // Upright (0) is by far the most common, so it is tried first.
      for (const rotation of [0, 90, 270, 180]) {
        const orientedCanvas = this.drawOriented(img, rotation, MAX_SIZE);

        const detection = await faceapi
          .detectSingleFace(orientedCanvas, detectorOptions)
          .withFaceLandmarks()
          .withFaceDescriptor();

        if (detection) {
          const totalTime = Date.now() - startTime;
          this.logger.log(
            `⏱️ detect=${totalTime}ms rotation=${rotation}° (${img.width}x${img.height})`,
          );
          return detection.descriptor;
        }
      }

      this.logger.warn(
        `No face detected in any orientation (${img.width}x${img.height}, ${Date.now() - startTime}ms)`,
      );
      return null;
    } catch (error) {
      this.logger.error('Error extracting descriptor:', error);
      return null;
    }
  }

  /**
   * Compare a face descriptor against stored descriptors
   */
  compareFaces(
    descriptor: Float32Array,
    storedDescriptors: number[][],
    threshold = 0.6,
  ): FaceMatchResult {
    if (!faceApiAvailable || !storedDescriptors || storedDescriptors.length === 0) {
      return { matched: false, distance: Infinity, bestMatchIndex: -1 };
    }

    let bestDistance = Infinity;
    let bestIndex = -1;

    for (let i = 0; i < storedDescriptors.length; i++) {
      const stored = new Float32Array(storedDescriptors[i]);
      const distance = faceapi.euclideanDistance(descriptor, stored);

      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = i;
      }
    }

    return {
      matched: bestDistance < threshold,
      distance: bestDistance,
      bestMatchIndex: bestIndex,
    };
  }

  /**
   * Register face from multiple image buffers (sequential to avoid CPU contention)
   */
  async registerFace(imageBuffers: Buffer[]): Promise<{
    descriptors: number[][];
    successCount: number;
    failedCount: number;
  }> {
    if (!faceApiAvailable || !this.modelsLoaded) {
      this.logger.warn('Face recognition not available for registration');
      return { descriptors: [], successCount: 0, failedCount: imageBuffers.length };
    }

    const startTime = Date.now();
    const descriptors: number[][] = [];
    let failedCount = 0;

    // Sequential processing — single CPU thread, parallel gives no benefit
    for (let i = 0; i < imageBuffers.length; i++) {
      this.logger.log(`🔄 Processing image ${i + 1}/${imageBuffers.length}...`);
      const descriptor = await this.extractDescriptor(imageBuffers[i]);
      if (descriptor) {
        descriptors.push(Array.from(descriptor));
      } else {
        failedCount++;
      }
    }

    const totalTime = Date.now() - startTime;
    this.logger.log(`⏱️ Registration total: ${totalTime}ms (${descriptors.length} success, ${failedCount} failed)`);

    return { descriptors, successCount: descriptors.length, failedCount };
  }

  isReady(): boolean {
    return this.modelsLoaded && faceApiAvailable;
  }
}

