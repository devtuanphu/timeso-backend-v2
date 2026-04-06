import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
/* eslint-disable @typescript-eslint/no-require-imports */
const faceapi = require('face-api.js');
const canvas = require('canvas');
const sharp = require('sharp');
/* eslint-enable @typescript-eslint/no-require-imports */
import * as path from 'path';
import * as fs from 'fs';

// Polyfill for Node.js environment
const { Canvas, Image, ImageData } = canvas;
(faceapi as any).env.monkeyPatch({ Canvas, Image, ImageData } as any);

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
    await this.loadModels();
  }

  /**
   * Load face-api.js neural network models
   * Dùng tinyFaceDetector + landmark68Tiny → nhanh gấp 10x so với ssdMobilenetv1
   */
  async loadModels(): Promise<void> {
    if (this.modelsLoaded) return;

    const modelsPath = path.join(process.cwd(), 'models');

    if (!fs.existsSync(modelsPath)) {
      this.logger.warn(`Models directory not found at ${modelsPath}. Face recognition will not work.`);
      return;
    }

    try {
      this.logger.log('Loading face-api.js models (tiny + recognition)...');

      // TinyFaceDetector: ~190KB vs ssdMobilenetv1: ~5.6MB → 10x faster
      await faceapi.nets.tinyFaceDetector.loadFromDisk(modelsPath);
      // Tiny landmarks: ~350KB vs full: ~350KB (same)
      await faceapi.nets.faceLandmark68TinyNet.loadFromDisk(modelsPath);
      // Recognition net: ~6.4MB (same, needed for 128-dim descriptor)
      await faceapi.nets.faceRecognitionNet.loadFromDisk(modelsPath);

      // Also load ssdMobilenetv1 + full landmarks as fallback for check-in
      try {
        await faceapi.nets.ssdMobilenetv1.loadFromDisk(modelsPath);
        await faceapi.nets.faceLandmark68Net.loadFromDisk(modelsPath);
      } catch {
        this.logger.warn('SSD MobileNet fallback models not loaded');
      }

      this.modelsLoaded = true;
      this.logger.log('Face-api.js models loaded successfully ✅');
    } catch (error) {
      this.logger.error('Failed to load face-api.js models:', error);
    }
  }

  /**
   * Resize image buffer using sharp (native libvips, 10-50x faster than canvas)
   * Returns a canvas object ready for face-api.js
   */
  private async resizeImage(imageBuffer: Buffer, maxSize = 320): Promise<any> {
    const t = Date.now();

    // Sharp: decode + resize in native C++ (milliseconds vs seconds)
    const resizedBuffer = await sharp(imageBuffer)
      .resize(maxSize, maxSize, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toBuffer();

    // Load small resized buffer into canvas for face-api.js
    const img = await canvas.loadImage(resizedBuffer);
    const resizedCanvas = canvas.createCanvas(img.width, img.height);
    const ctx = resizedCanvas.getContext('2d');
    ctx.drawImage(img, 0, 0);

    this.logger.log(`📐 Resized: → ${img.width}x${img.height} (sharp ${Date.now() - t}ms)`);
    return resizedCanvas;
  }

  /**
   * Extract 128-dim face descriptor from an image buffer
   * Uses tinyFaceDetector (10x faster) + resize to 320px
   */
  async extractDescriptor(imageBuffer: Buffer): Promise<Float32Array | null> {
    if (!this.modelsLoaded) {
      this.logger.warn('Models not loaded, cannot extract descriptor');
      return null;
    }

    try {
      const startTime = Date.now();
      const resizedCanvas = await this.resizeImage(imageBuffer, 320);

      const detection = await faceapi
        .detectSingleFace(resizedCanvas as any, new faceapi.TinyFaceDetectorOptions({
          inputSize: 320,
          scoreThreshold: 0.3,
        }))
        .withFaceLandmarks(true) // true = use tiny landmarks
        .withFaceDescriptor();

      const elapsed = Date.now() - startTime;
      this.logger.log(`⏱️ Face detection took ${elapsed}ms`);

      if (!detection) {
        this.logger.warn('No face detected in image');
        return null;
      }

      return detection.descriptor;
    } catch (error) {
      this.logger.error('Error extracting face descriptor:', error);
      return null;
    }
  }

  /**
   * Extract descriptor using SSD MobileNet (more accurate, for check-in/out)
   */
  async extractDescriptorAccurate(imageBuffer: Buffer): Promise<Float32Array | null> {
    if (!this.modelsLoaded) {
      return null;
    }

    try {
      const resizedCanvas = await this.resizeImage(imageBuffer, 640);

      const detection = await faceapi
        .detectSingleFace(resizedCanvas as any)
        .withFaceLandmarks()
        .withFaceDescriptor();

      if (!detection) {
        this.logger.warn('No face detected in image (accurate mode)');
        return null;
      }

      return detection.descriptor;
    } catch (error) {
      this.logger.error('Error extracting face descriptor (accurate):', error);
      return null;
    }
  }

  /**
   * Compare a face descriptor against stored descriptors
   * @returns Match result with distance (lower = better, < 0.6 = match)
   */
  compareFaces(
    descriptor: Float32Array,
    storedDescriptors: number[][],
    threshold = 0.6,
  ): FaceMatchResult {
    if (!storedDescriptors || storedDescriptors.length === 0) {
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
   * Register face from multiple image buffers
   * Uses Promise.all for PARALLEL processing (3x faster)
   */
  async registerFace(imageBuffers: Buffer[]): Promise<{
    descriptors: number[][];
    successCount: number;
    failedCount: number;
  }> {
    const startTime = Date.now();

    // Process all images in PARALLEL instead of sequential
    const results = await Promise.all(
      imageBuffers.map(buffer => this.extractDescriptor(buffer))
    );

    const descriptors: number[][] = [];
    let failedCount = 0;

    for (const descriptor of results) {
      if (descriptor) {
        descriptors.push(Array.from(descriptor));
      } else {
        failedCount++;
      }
    }

    const elapsed = Date.now() - startTime;
    this.logger.log(`⏱️ Total registration took ${elapsed}ms for ${imageBuffers.length} images`);

    return {
      descriptors,
      successCount: descriptors.length,
      failedCount,
    };
  }

  /**
   * Check if models are loaded and ready
   */
  isReady(): boolean {
    return this.modelsLoaded;
  }
}
