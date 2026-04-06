import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
/* eslint-disable @typescript-eslint/no-require-imports */
const faceapi = require('face-api.js');
const canvas = require('canvas');
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
   */
  async loadModels(): Promise<void> {
    if (this.modelsLoaded) return;

    const modelsPath = path.join(process.cwd(), 'models');

    if (!fs.existsSync(modelsPath)) {
      this.logger.warn(`Models directory not found at ${modelsPath}. Face recognition will not work.`);
      return;
    }

    try {
      this.logger.log('Loading face-api.js models...');

      await faceapi.nets.ssdMobilenetv1.loadFromDisk(modelsPath);
      await faceapi.nets.faceLandmark68Net.loadFromDisk(modelsPath);
      await faceapi.nets.faceRecognitionNet.loadFromDisk(modelsPath);

      this.modelsLoaded = true;
      this.logger.log('Face-api.js models loaded successfully ✅');
    } catch (error) {
      this.logger.error('Failed to load face-api.js models:', error);
    }
  }

  /**
   * Extract 128-dim face descriptor from an image buffer
   * Resize to 640px first for performance (camera sends 4000x3000px)
   */
  async extractDescriptor(imageBuffer: Buffer): Promise<Float32Array | null> {
    if (!this.modelsLoaded) {
      this.logger.warn('Models not loaded, cannot extract descriptor');
      return null;
    }

    try {
      const img = await canvas.loadImage(imageBuffer);

      // Resize to 640px max width for fast processing
      const MAX_SIZE = 640;
      let { width, height } = img;
      if (width > MAX_SIZE || height > MAX_SIZE) {
        const scale = MAX_SIZE / Math.max(width, height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }

      const resizedCanvas = canvas.createCanvas(width, height);
      const ctx = resizedCanvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);

      this.logger.log(`📐 Resized image: ${img.width}x${img.height} → ${width}x${height}`);

      const detection = await faceapi
        .detectSingleFace(resizedCanvas as any)
        .withFaceLandmarks()
        .withFaceDescriptor();

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
   * @returns Array of 128-dim descriptors (one per image)
   */
  async registerFace(imageBuffers: Buffer[]): Promise<{
    descriptors: number[][];
    successCount: number;
    failedCount: number;
  }> {
    const descriptors: number[][] = [];
    let failedCount = 0;

    for (const buffer of imageBuffers) {
      const descriptor = await this.extractDescriptor(buffer);
      if (descriptor) {
        descriptors.push(Array.from(descriptor));
      } else {
        failedCount++;
      }
    }

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
