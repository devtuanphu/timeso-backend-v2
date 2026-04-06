import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as path from 'path';
import * as fs from 'fs';

/* eslint-disable @typescript-eslint/no-require-imports */
// Load native TensorFlow C++ backend FIRST (10-20x faster than pure JS)
let tfBackend = 'cpu-js';
try {
  require('@tensorflow/tfjs-node');
  tfBackend = 'tfjs-node (C++)';
} catch {
  console.warn('⚠️ @tensorflow/tfjs-node not loaded, using slow JS backend');
}

// Use @vladmandic/face-api (modern fork, compatible with tfjs-node)
const faceapi = require('@vladmandic/face-api');
const canvas = require('canvas');
/* eslint-enable @typescript-eslint/no-require-imports */

// Polyfill for Node.js environment
const { Canvas, Image, ImageData } = canvas;
faceapi.env.monkeyPatch({ Canvas, Image, ImageData });

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
   */
  async loadModels(): Promise<void> {
    if (this.modelsLoaded) return;

    const modelsPath = path.join(process.cwd(), 'models');

    if (!fs.existsSync(modelsPath)) {
      this.logger.warn(`Models directory not found at ${modelsPath}.`);
      return;
    }

    try {
      this.logger.log(`Loading face models... (backend: ${tfBackend})`);

      await faceapi.nets.ssdMobilenetv1.loadFromDisk(modelsPath);
      await faceapi.nets.faceLandmark68Net.loadFromDisk(modelsPath);
      await faceapi.nets.faceRecognitionNet.loadFromDisk(modelsPath);

      this.modelsLoaded = true;
      this.logger.log(`Face models loaded ✅ (backend: ${tfBackend})`);
    } catch (error) {
      this.logger.error('Failed to load face models:', error);
    }
  }

  /**
   * Extract 128-dim face descriptor from an image buffer
   * Resize to 640px using canvas for consistent quality
   */
  async extractDescriptor(imageBuffer: Buffer): Promise<Float32Array | null> {
    if (!this.modelsLoaded) {
      this.logger.warn('Models not loaded');
      return null;
    }

    try {
      const startTime = Date.now();

      // Decode + resize using canvas (consistent quality for face detection)
      const img = await canvas.loadImage(imageBuffer);
      const MAX_SIZE = 640;
      let w = img.width;
      let h = img.height;
      if (w > MAX_SIZE || h > MAX_SIZE) {
        const scale = MAX_SIZE / Math.max(w, h);
        w = Math.round(w * scale);
        h = Math.round(h * scale);
      }
      const resizedCanvas = canvas.createCanvas(w, h);
      resizedCanvas.getContext('2d').drawImage(img, 0, 0, w, h);

      const resizeTime = Date.now() - startTime;

      // Face detection + descriptor extraction
      const detectStart = Date.now();
      const detection = await faceapi
        .detectSingleFace(resizedCanvas)
        .withFaceLandmarks()
        .withFaceDescriptor();

      const detectTime = Date.now() - detectStart;
      const totalTime = Date.now() - startTime;
      this.logger.log(`⏱️ resize=${resizeTime}ms detect=${detectTime}ms total=${totalTime}ms (${img.width}x${img.height}→${w}x${h})`);

      if (!detection) {
        this.logger.warn('No face detected');
        return null;
      }

      return detection.descriptor;
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
   * Register face from multiple image buffers (sequential to avoid CPU contention)
   */
  async registerFace(imageBuffers: Buffer[]): Promise<{
    descriptors: number[][];
    successCount: number;
    failedCount: number;
  }> {
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
    return this.modelsLoaded;
  }
}
