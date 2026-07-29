type AeroScenarioType = 'Cylinder' | 'Flat Plate' | 'Airfoil Wing' | 'Kelvin-Helmholtz' | 'Von Kármán Street';
class Noise {
  private seed: number;
  private p: Uint8Array;
  constructor(seed: number = Math.random()) {
    this.seed = seed;
    this.p = new Uint8Array(512);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) {
      p[i] = Math.floor(Math.random() * 256);
    }
    for (let i = 0; i < 512; i++) {
      this.p[i] = p[i & 255];
    }
  }
  private fade(t: number) {
    return t * t * t * (t * (t * 6 - 15) + 10);
  }
  private lerp(t: number, a: number, b: number) {
    return a + t * (b - a);
  }
  private grad(hash: number, x: number, y: number) {
    const h = hash & 15;
    const u = h < 8 ? x : y;
    const v = h < 4 ? y : h === 12 || h === 14 ? x : 0;
    return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
  }
  public perlin2(x: number, y: number) {
    let X = Math.floor(x) & 255, Y = Math.floor(y) & 255;
    x -= Math.floor(x);
    y -= Math.floor(y);
    const u = this.fade(x), v = this.fade(y);
    const A = this.p[X] + Y, B = this.p[X + 1] + Y;
    return this.lerp(v, 
      this.lerp(u, this.grad(this.p[A], x, y), this.grad(this.p[B], x - 1, y)),
      this.lerp(u, this.grad(this.p[A + 1], x, y - 1), this.grad(this.p[B + 1], x - 1, y - 1))
    );
  }
  public fbm2d(x: number, y: number, octaves: number = 4, persistence: number = 0.5): number {
    let total = 0;
    let frequency = 1;
    let amplitude = 1;
    let maxValue = 0;
    for(let i = 0; i < octaves; i++) {
      total += this.perlin2(x * frequency, y * frequency) * amplitude;
      maxValue += amplitude;
      amplitude *= persistence;
      frequency *= 2;
    }
    return total / maxValue;
  }
}
import React, { useEffect, useRef, useState } from 'react';
type OrbitalScenarioType = 'Galaxy' | 'Binary Star';
type AeroBrushMode = 'Inject Fluid' | 'Draw Obstacle';
type ErosionBrushMode = 'Raise Terrain' | 'Lower Terrain';
type TerrainType = 'Volcanic Peak' | 'Fault Line Valley';
import { Wind, ThermometerSun, Waves, Settings, Activity, BookOpen, Calculator, ArrowDownCircle, Layers, Globe, Droplets, Cpu, Orbit } from 'lucide-react';
class FluidSolver {
  public N: number;
  private size: number;
  private dt: number;
  private diff: number;
  public visc: number;
  public s: Float32Array;
  public density: Float32Array;
  public Vx: Float32Array;
  public Vy: Float32Array;
  public Vx0: Float32Array;
  public Vy0: Float32Array;
  public p: Float32Array;
  public div: Float32Array;
  public obstacles: Uint8Array;
  constructor(N: number, diffusion: number, viscosity: number, dt: number) {
    this.N = N;
    this.size = (N + 2) * (N + 2);
    this.dt = dt;
    this.diff = diffusion;
    this.visc = viscosity;
    this.s = new Float32Array(this.size);
    this.density = new Float32Array(this.size);
    this.Vx = new Float32Array(this.size);
    this.Vy = new Float32Array(this.size);
    this.Vx0 = new Float32Array(this.size);
    this.Vy0 = new Float32Array(this.size);
    this.p = new Float32Array(this.size);
    this.div = new Float32Array(this.size);
    this.obstacles = new Uint8Array(this.size);
  }
  public IX(x: number, y: number): number {
    x = Math.max(0, Math.min(x, this.N + 1));
    y = Math.max(0, Math.min(y, this.N + 1));
    return x + y * (this.N + 2);
  }
  public addDensity(x: number, y: number, amount: number) {
    this.density[this.IX(x, y)] += amount;
  }
  public addVelocity(x: number, y: number, amountX: number, amountY: number) {
    const index = this.IX(x, y);
    this.Vx[index] += amountX;
    this.Vy[index] += amountY;
  }
  private setBnd(b: number, x: Float32Array) {
    const N = this.N;
    for (let i = 1; i <= N; i++) {
      x[this.IX(0, i)] = b === 1 ? -x[this.IX(1, i)] : x[this.IX(1, i)];
      x[this.IX(N + 1, i)] = b === 1 ? -x[this.IX(N, i)] : x[this.IX(N, i)];
      x[this.IX(i, 0)] = b === 2 ? -x[this.IX(i, 1)] : x[this.IX(i, 1)];
      x[this.IX(i, N + 1)] = b === 2 ? -x[this.IX(i, N)] : x[this.IX(i, N)];
    }
    x[this.IX(0, 0)] = 0.5 * (x[this.IX(1, 0)] + x[this.IX(0, 1)]);
    x[this.IX(0, N + 1)] = 0.5 * (x[this.IX(1, N + 1)] + x[this.IX(0, N)]);
    x[this.IX(N + 1, 0)] = 0.5 * (x[this.IX(N, 0)] + x[this.IX(N + 1, 1)]);
    x[this.IX(N + 1, N + 1)] = 0.5 * (x[this.IX(N, N + 1)] + x[this.IX(N + 1, N)]);
    for (let j = 1; j <= N; j++) {
      for (let i = 1; i <= N; i++) {
        if (this.obstacles[this.IX(i, j)] === 1) {
          x[this.IX(i, j)] = 0;
        }
      }