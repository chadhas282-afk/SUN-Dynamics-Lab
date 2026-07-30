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
    }
  }
  private linSolve(b: number, x: Float32Array, x0: Float32Array, a: number, c: number, iter: number = 20) {
    const N = this.N;
    const cRecip = 1.0 / c;
    for (let k = 0; k < iter; k++) {
      for (let j = 1; j <= N; j++) {
        for (let i = 1; i <= N; i++) {
          if (this.obstacles[this.IX(i, j)] === 0) {
            x[this.IX(i, j)] = (x0[this.IX(i, j)] + a * (x[this.IX(i + 1, j)] + x[this.IX(i - 1, j)] + x[this.IX(i, j + 1)] + x[this.IX(i, j - 1)])) * cRecip;
          }
        }
      }
      this.setBnd(b, x);
    }
  }
  private diffuse(b: number, x: Float32Array, x0: Float32Array, diff: number, dt: number) {
    const a = this.dt * diff * this.N * this.N;
    this.linSolve(b, x, x0, a, 1 + 4 * a);
  }
  private advect(b: number, d: Float32Array, d0: Float32Array, u: Float32Array, v: Float32Array, dt: number) {
    const N = this.N;
    let i0, j0, i1, j1;
    let x, y, s0, t0, s1, t1;
    let dt0 = dt * N;
    for (let j = 1; j <= N; j++) {
      for (let i = 1; i <= N; i++) {
        if (this.obstacles[this.IX(i, j)] === 1) continue;
        x = i - dt0 * u[this.IX(i, j)];
        y = j - dt0 * v[this.IX(i, j)];
        if (x < 0.5) x = 0.5;
        if (x > N + 0.5) x = N + 0.5;
        i0 = Math.floor(x);
        i1 = i0 + 1;
        if (y < 0.5) y = 0.5;
        if (y > N + 0.5) y = N + 0.5;
        j0 = Math.floor(y);
        j1 = j0 + 1;
        s1 = x - i0;
        s0 = 1.0 - s1;
        t1 = y - j0;
        t0 = 1.0 - t1;
        d[this.IX(i, j)] = 
          s0 * (t0 * d0[this.IX(i0, j0)] + t1 * d0[this.IX(i0, j1)]) +
          s1 * (t0 * d0[this.IX(i1, j0)] + t1 * d0[this.IX(i1, j1)]);
      }
    }
    this.setBnd(b, d);
  }
  private project(u: Float32Array, v: Float32Array, p: Float32Array, div: Float32Array) {
    const N = this.N;
    const h = 1.0 / N;
    for (let j = 1; j <= N; j++) {
      for (let i = 1; i <= N; i++) {
        if (this.obstacles[this.IX(i, j)] === 1) {
          div[this.IX(i, j)] = 0;
          p[this.IX(i, j)] = 0;
        } else {
          div[this.IX(i, j)] = -0.5 * h * (u[this.IX(i + 1, j)] - u[this.IX(i - 1, j)] + v[this.IX(i, j + 1)] - v[this.IX(i, j - 1)]);
          p[this.IX(i, j)] = 0;
        }
      }
    }
    this.setBnd(0, div);
    this.setBnd(0, p);
    this.linSolve(0, p, div, 1, 4);
    for (let j = 1; j <= N; j++) {
      for (let i = 1; i <= N; i++) {
        if (this.obstacles[this.IX(i, j)] === 0) {
          u[this.IX(i, j)] -= 0.5 * (p[this.IX(i + 1, j)] - p[this.IX(i - 1, j)]) / h;
          v[this.IX(i, j)] -= 0.5 * (p[this.IX(i, j + 1)] - p[this.IX(i, j - 1)]) / h;
        }
      }
    }
    this.setBnd(1, u);
    this.setBnd(2, v);
  }
  public step() {
    this.diffuse(1, this.Vx0, this.Vx, this.visc, this.dt);
    this.diffuse(2, this.Vy0, this.Vy, this.visc, this.dt);
    this.project(this.Vx0, this.Vy0, this.p, this.div);
    this.advect(1, this.Vx, this.Vx0, this.Vx0, this.Vy0, this.dt);
    this.advect(2, this.Vy, this.Vy0, this.Vx0, this.Vy0, this.dt);
    this.project(this.Vx, this.Vy, this.p, this.div);
    this.diffuse(0, this.s, this.density, this.diff, this.dt);
    this.advect(0, this.density, this.s, this.Vx, this.Vy, this.dt);
    for(let i = 0; i < this.density.length; i++) {
      this.density[i] *= 0.99;
    }
  }
}
class ConvectionSolver {
  public N: number;
  private size: number;
  private dt: number;
  private diff: number;
  public visc: number;
  public T: Float32Array;
  public T0: Float32Array;
  public Vx: Float32Array;
  public Vy: Float32Array;
  public Vx0: Float32Array;
  public Vy0: Float32Array;
  public p: Float32Array;
  public div: Float32Array;
  public ambientT: number = 0;
  public coriolisF: number = 0;
  public beta: number = 0.05;
  constructor(N: number, diffusion: number, viscosity: number, dt: number) {
    this.N = N;
    this.size = (N + 2) * (N + 2);
    this.dt = dt;
    this.diff = diffusion;
    this.visc = viscosity;
    this.T = new Float32Array(this.size);
    this.T0 = new Float32Array(this.size);
    this.Vx = new Float32Array(this.size);
    this.Vy = new Float32Array(this.size);
    this.Vx0 = new Float32Array(this.size);
    this.Vy0 = new Float32Array(this.size);
    this.p = new Float32Array(this.size);
    this.div = new Float32Array(this.size);
  }
  public IX(x: number, y: number): number {
    x = Math.max(0, Math.min(x, this.N + 1));
    y = Math.max(0, Math.min(y, this.N + 1));
    return x + y * (this.N + 2);
  }
  public addTemperature(x: number, y: number, amount: number) {
    this.T[this.IX(x, y)] += amount;
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
  }
  private linSolve(b: number, x: Float32Array, x0: Float32Array, a: number, c: number) {
    const N = this.N;
    const cRecip = 1.0 / c;
    for (let k = 0; k < 20; k++) {
      for (let j = 1; j <= N; j++) {
        for (let i = 1; i <= N; i++) {
          x[this.IX(i, j)] = (x0[this.IX(i, j)] + a * (x[this.IX(i + 1, j)] + x[this.IX(i - 1, j)] + x[this.IX(i, j + 1)] + x[this.IX(i, j - 1)])) * cRecip;
        }
      }
      this.setBnd(b, x);
    }
  }
  private diffuse(b: number, x: Float32Array, x0: Float32Array, diff: number, dt: number) {
    const a = this.dt * diff * this.N * this.N;
    this.linSolve(b, x, x0, a, 1 + 4 * a);
  }
  private advect(b: number, d: Float32Array, d0: Float32Array, u: Float32Array, v: Float32Array, dt: number) {
    const N = this.N;
    let i0, j0, i1, j1;
    let x, y, s0, t0, s1, t1;
    let dt0 = dt * N;
    for (let j = 1; j <= N; j++) {
      for (let i = 1; i <= N; i++) {
        x = i - dt0 * u[this.IX(i, j)];
        y = j - dt0 * v[this.IX(i, j)];
        if (x < 0.5) x = 0.5;
        if (x > N + 0.5) x = N + 0.5;
        i0 = Math.floor(x);
        i1 = i0 + 1;
        if (y < 0.5) y = 0.5;
        if (y > N + 0.5) y = N + 0.5;
        j0 = Math.floor(y);
        j1 = j0 + 1;
        s1 = x - i0;
        s0 = 1.0 - s1;
        t1 = y - j0;
        t0 = 1.0 - t1;
        d[this.IX(i, j)] = 
          s0 * (t0 * d0[this.IX(i0, j0)] + t1 * d0[this.IX(i0, j1)]) +
          s1 * (t0 * d0[this.IX(i1, j0)] + t1 * d0[this.IX(i1, j1)]);
      }
    }
    this.setBnd(b, d);
  }
  private project(u: Float32Array, v: Float32Array, p: Float32Array, div: Float32Array) {
    const N = this.N;
    const h = 1.0 / N;
    for (let j = 1; j <= N; j++) {
      for (let i = 1; i <= N; i++) {
        div[this.IX(i, j)] = -0.5 * h * (u[this.IX(i + 1, j)] - u[this.IX(i - 1, j)] + v[this.IX(i, j + 1)] - v[this.IX(i, j - 1)]);
        p[this.IX(i, j)] = 0;
      }
    }
    this.setBnd(0, div);
    this.setBnd(0, p);
    this.linSolve(0, p, div, 1, 4);
    for (let j = 1; j <= N; j++) {
      for (let i = 1; i <= N; i++) {
        u[this.IX(i, j)] -= 0.5 * (p[this.IX(i + 1, j)] - p[this.IX(i - 1, j)]) / h;
        v[this.IX(i, j)] -= 0.5 * (p[this.IX(i, j + 1)] - p[this.IX(i, j - 1)]) / h;
      }
    }
    this.setBnd(1, u);
    this.setBnd(2, v);
  }
  public step() {
    for (let j = 1; j <= this.N; j++) {
      for (let i = 1; i <= this.N; i++) {
        const idx = this.IX(i, j);
        const tempDiff = this.T[idx] - this.ambientT;
        this.Vy[idx] -= this.beta * tempDiff * this.dt;
        if (this.coriolisF !== 0) {
           const u = this.Vx[idx];
           const v = this.Vy[idx];
           this.Vx[idx] += this.coriolisF * v * this.dt;
           this.Vy[idx] -= this.coriolisF * u * this.dt;
        }
      }
    }
    this.diffuse(1, this.Vx0, this.Vx, this.visc, this.dt);
    this.diffuse(2, this.Vy0, this.Vy, this.visc, this.dt);
    this.project(this.Vx0, this.Vy0, this.p, this.div);
    this.advect(1, this.Vx, this.Vx0, this.Vx0, this.Vy0, this.dt);
    this.advect(2, this.Vy, this.Vy0, this.Vx0, this.Vy0, this.dt);
    this.project(this.Vx, this.Vy, this.p, this.div);
    this.diffuse(0, this.T0, this.T, this.diff, this.dt);
    this.advect(0, this.T, this.T0, this.Vx, this.Vy, this.dt);
  }
}
class ErosionSolver {
  public N: number;
  private size: number;
  public height: Float32Array;
  public water: Float32Array;
  public sediment: Float32Array;
  public Vx: Float32Array;
  public Vy: Float32Array;
  public rainfall: number = 0.01;
  public erodibility: number = 0.01;
  public deposition: number = 0.01;
  public dt: number = 0.1;
  public totalKineticEnergy = 0;
  constructor(N: number) {
    this.N = N;
    this.size = N * N;
    this.height = new Float32Array(this.size);
    this.water = new Float32Array(this.size);
    this.sediment = new Float32Array(this.size);
    this.Vx = new Float32Array(this.size);
    this.Vy = new Float32Array(this.size);
  }
  public IX(x: number, y: number): number {
    return x + y * this.N;
  }
  public generateTerrain(type: 'Volcanic Peak' | 'Fault Line Valley') {
    const noise = new Noise(Math.random());
    const cx = this.N / 2;
    const cy = this.N / 2;
    const maxR = this.N / 2;
    for (let y = 0; y < this.N; y++) {
      for (let x = 0; x < this.N; x++) {
        let h = noise.fbm2d(x * 0.03, y * 0.03, 6, 0.5) * 0.5 + 0.5;
        if (type === 'Volcanic Peak') {
          const dx = x - cx;
          const dy = y - cy;
          const d = Math.sqrt(dx*dx + dy*dy);
          const cone = Math.max(0, 1.0 - d / maxR);
          h = h * 0.4 + cone * 0.8;
          if (d < 10) h -= (10 - d) * 0.05;
        } else {
          const distToFault = Math.abs((x - cx) + Math.sin(y * 0.05) * 20);
          const valley = Math.max(0, 1.0 - distToFault / 30);
          h = h * 0.7 - valley * 0.5 + 0.2;
        }
        this.height[this.IX(x, y)] = Math.max(0, h);
        this.water[this.IX(x, y)] = 0;
        this.sediment[this.IX(x, y)] = 0;
        this.Vx[this.IX(x, y)] = 0;
        this.Vy[this.IX(x, y)] = 0;
      }
    }
  }
  public step() {
    const N = this.N;
    const newWater = new Float32Array(this.size);
    const newSediment = new Float32Array(this.size);
    this.totalKineticEnergy = 0;
    for (let i = 0; i < this.size; i++) {
      this.water[i] += this.rainfall * this.dt;
    }
    for (let y = 1; y < N - 1; y++) {
      for (let x = 1; x < N - 1; x++) {
        const i = this.IX(x, y);
        const h = this.height[i] + this.water[i];
        const hL = this.height[this.IX(x-1, y)] + this.water[this.IX(x-1, y)];
        const hR = this.height[this.IX(x+1, y)] + this.water[this.IX(x+1, y)];
        const hT = this.height[this.IX(x, y-1)] + this.water[this.IX(x, y-1)];
        const hB = this.height[this.IX(x, y+1)] + this.water[this.IX(x, y+1)];
        const dx = (hL - hR) * 0.5;
        const dy = (hT - hB) * 0.5;
        this.Vx[i] = (this.Vx[i] + dx * this.dt) * 0.9;
        this.Vy[i] = (this.Vy[i] + dy * this.dt) * 0.9;
        this.totalKineticEnergy += this.Vx[i]*this.Vx[i] + this.Vy[i]*this.Vy[i];
        const velX = this.Vx[i];
        const velY = this.Vy[i];
        let srcX = x - velX * this.dt;
        let srcY = y - velY * this.dt;
        srcX = Math.max(0, Math.min(N - 1, srcX));
        srcY = Math.max(0, Math.min(N - 1, srcY));
        const sx0 = Math.floor(srcX);
        const sx1 = Math.min(N - 1, sx0 + 1);
        const sy0 = Math.floor(srcY);
        const sy1 = Math.min(N - 1, sy0 + 1);
        const wx1 = srcX - sx0;
        const wx0 = 1 - wx1;
        const wy1 = srcY - sy0;
        const wy0 = 1 - wy1;
        const valW = 
          wx0 * wy0 * this.water[this.IX(sx0, sy0)] +
          wx1 * wy0 * this.water[this.IX(sx1, sy0)] +
          wx0 * wy1 * this.water[this.IX(sx0, sy1)] +
          wx1 * wy1 * this.water[this.IX(sx1, sy1)];
        const valS = 
          wx0 * wy0 * this.sediment[this.IX(sx0, sy0)] +
          wx1 * wy0 * this.sediment[this.IX(sx1, sy0)] +
          wx0 * wy1 * this.sediment[this.IX(sx0, sy1)] +
          wx1 * wy1 * this.sediment[this.IX(sx1, sy1)];
        newWater[i] = valW;
        newSediment[i] = valS;
      }
    }
    this.water = newWater;
    this.sediment = newSediment;
    for (let y = 1; y < N - 1; y++) {
      for (let x = 1; x < N - 1; x++) {
        const i = this.IX(x, y);
        if (this.water[i] <= 0.001) continue;
        const velSq = this.Vx[i]*this.Vx[i] + this.Vy[i]*this.Vy[i];
        const capacity = Math.max(0.01, velSq) * 2.0;
        if (this.sediment[i] < capacity) {
          const amount = (capacity - this.sediment[i]) * this.erodibility * this.dt;
          const actualErosion = Math.min(amount, this.height[i] * 0.1);
          this.height[i] -= actualErosion;
          this.sediment[i] += actualErosion;
        } else {
          const amount = (this.sediment[i] - capacity) * this.deposition * this.dt;
          this.height[i] += amount;
          this.sediment[i] -= amount;
        }
        this.water[i] *= 0.99;
      }
    }
  }
}
class GravitySolver {
  public numBodies: number;
  public G: number;
  public dt: number;
  public softening: number;
  public px: Float32Array;
  public py: Float32Array;
  public vx: Float32Array;
  public vy: Float32Array;
  public ax: Float32Array;
  public ay: Float32Array;
  public mass: Float32Array;
  public totalKineticEnergy: number = 0;
  constructor(numBodies: number, G: number = 1.0, dt: number = 0.01) {
    this.numBodies = numBodies;
    this.G = G;
    this.dt = dt;
    this.softening = 1.5;
    this.px = new Float32Array(numBodies);
    this.py = new Float32Array(numBodies);
    this.vx = new Float32Array(numBodies);
    this.vy = new Float32Array(numBodies);
    this.ax = new Float32Array(numBodies);
    this.ay = new Float32Array(numBodies);
    this.mass = new Float32Array(numBodies);
  }
  public initGalaxy(width: number, height: number) {
    const cx = width / 2;
    const cy = height / 2;
    this.px[0] = cx;
    this.py[0] = cy;
    this.vx[0] = 0;
    this.vy[0] = 0;
    this.mass[0] = 10000;
    for (let i = 1; i < this.numBodies; i++) {
      const angle = Math.random() * Math.PI * 2;
      const radius = 50 + Math.random() * (width / 2 - 100);
      this.px[i] = cx + Math.cos(angle) * radius;
      this.py[i] = cy + Math.sin(angle) * radius;
      const v = Math.sqrt(this.G * this.mass[0] / radius);
      this.vx[i] = -Math.sin(angle) * v;
      this.vy[i] = Math.cos(angle) * v;
      this.mass[i] = 1 + Math.random() * 5;
    }
  }
  public initBinaryStar(width: number, height: number) {
    const cx = width / 2;
    const cy = height / 2;
    this.px[0] = cx - 100;
    this.py[0] = cy;
    this.vx[0] = 0;
    this.vy[0] = 15;
    this.mass[0] = 5000;
    this.px[1] = cx + 100;
    this.py[1] = cy;
    this.vx[1] = 0;
    this.vy[1] = -15;
    this.mass[1] = 5000;
    for (let i = 2; i < this.numBodies; i++) {
      this.px[i] = cx + (Math.random() - 0.5) * width;
      this.py[i] = cy + (Math.random() - 0.5) * height;
      this.vx[i] = (Math.random() - 0.5) * 20;
      this.vy[i] = (Math.random() - 0.5) * 20;
      this.mass[i] = 1 + Math.random() * 5;
    }
  }
  public step() {
    for (let i = 0; i < this.numBodies; i++) {
      this.ax[i] = 0;
      this.ay[i] = 0;
    }
    for (let i = 0; i < this.numBodies; i++) {
      for (let j = i + 1; j < this.numBodies; j++) {
        const dx = this.px[j] - this.px[i];
        const dy = this.py[j] - this.py[i];
        const distSq = dx * dx + dy * dy + this.softening * this.softening;
        const dist = Math.sqrt(distSq);
        const f = this.G / (distSq * dist);
        const forceX = f * dx;
        const forceY = f * dy;
        this.ax[i] += forceX * this.mass[j];
        this.ay[i] += forceY * this.mass[j];
        this.ax[j] -= forceX * this.mass[i];
        this.ay[j] -= forceY * this.mass[i];
      }
    }
    this.totalKineticEnergy = 0;
    for (let i = 0; i < this.numBodies; i++) {
      this.vx[i] += this.ax[i] * this.dt;
      this.vy[i] += this.ay[i] * this.dt;
      this.px[i] += this.vx[i] * this.dt;
      this.py[i] += this.vy[i] * this.dt;
      this.totalKineticEnergy += 0.5 * this.mass[i] * (this.vx[i] * this.vx[i] + this.vy[i] * this.vy[i]);
    }
  }
}
function ContinuityAnimation() {
  return (
    <div className="w-full h-48 bg-dark-900 border border-dark-700 rounded-lg overflow-hidden relative flex items-center justify-center">
      <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 400 200" preserveAspectRatio="none">
        <defs>
          <linearGradient id="pipeGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#1e293b" />
            <stop offset="50%" stopColor="#0f172a" />
            <stop offset="100%" stopColor="#1e293b" />
          </linearGradient>
        </defs>
        <path d="M 0 40 L 120 40 C 160 40, 180 80, 200 80 C 220 80, 240 40, 280 40 L 400 40" fill="none" stroke="#64748b" strokeWidth="4" />
        <path d="M 0 160 L 120 160 C 160 160, 180 120, 200 120 C 220 120, 240 160, 280 160 L 400 160" fill="none" stroke="#64748b" strokeWidth="4" />
        <path d="M 0 40 L 120 40 C 160 40, 180 80, 200 80 C 220 80, 240 40, 280 40 L 400 40 L 400 160 L 280 160 C 240 160, 220 120, 200 120 C 180 120, 160 160, 120 160 L 0 160 Z" fill="url(#pipeGrad)" opacity="0.5" />
        <g stroke="#3b82f6" strokeWidth="2" strokeLinecap="round" className="animate-[slideRight_4s_linear_infinite]" opacity="0.6">
          <line x1="20" y1="60" x2="60" y2="60" /> <polygon points="60,56 68,60 60,64" fill="#3b82f6" />
          <line x1="20" y1="100" x2="60" y2="100" /> <polygon points="60,96 68,100 60,104" fill="#3b82f6" />
          <line x1="20" y1="140" x2="60" y2="140" /> <polygon points="60,136 68,140 60,144" fill="#3b82f6" />
        </g>
        <g stroke="#06b6d4" strokeWidth="2" strokeLinecap="round" className="animate-[slideRightFast_1s_linear_infinite]" opacity="0.8">
          <line x1="180" y1="100" x2="210" y2="100" /> <polygon points="210,96 218,100 210,104" fill="#06b6d4" />
        </g>
        <g stroke="#3b82f6" strokeWidth="2" strokeLinecap="round" className="animate-[slideRight_4s_linear_infinite]" opacity="0.6">
          <line x1="300" y1="60" x2="340" y2="60" /> <polygon points="340,56 348,60 340,64" fill="#3b82f6" />
          <line x1="300" y1="100" x2="340" y2="100" /> <polygon points="340,96 348,100 340,104" fill="#3b82f6" />
          <line x1="300" y1="140" x2="340" y2="140" /> <polygon points="340,136 348,140 340,144" fill="#3b82f6" />
        </g>
      </svg>
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
         <div className="w-[10px] h-[10px] bg-white rounded-full absolute top-[100px] left-[50px] animate-[flowParticle_3s_linear_infinite] shadow-[0_0_10px_white]" />
      </div>
      <div className="absolute bottom-2 right-3 text-[10px] text-blue-400 font-mono tracking-wider">
        A₁V₁ = A₂V₂
      </div>
      <style>{`
        @keyframes slideRightFast {
          from { transform: translateX(0px); opacity: 0; }
          10% { opacity: 1; }
          90% { opacity: 1; }
          to { transform: translateX(40px); opacity: 0; }
        }
        @keyframes flowParticle {
          0% { transform: translate(0px, 0px) scale(1); opacity: 0; }
          10% { opacity: 1; }
          40% { transform: translate(120px, 0px) scale(1); }
          50% { transform: translate(150px, 0px) scale(0.5); }
          60% { transform: translate(200px, 0px) scale(1); }
          90% { opacity: 1; }
          100% { transform: translate(300px, 0px) scale(1); opacity: 0; }
        }
      `}</style>
    </div>
  );
}
function CycloneAnimation() {
  return (
    <div className="w-full h-48 bg-dark-900 border border-dark-700 rounded-lg overflow-hidden relative flex items-center justify-center">
      <div className="absolute inset-0 flex items-center justify-center opacity-10 pointer-events-none">
         <div className="w-48 h-48 rounded-full border border-white" />
         <div className="absolute w-32 h-32 rounded-full border border-white" />
         <div className="absolute w-16 h-16 rounded-full border border-white" />
      </div>
      <div className="relative w-48 h-48 animate-[spin_10s_linear_infinite]">
         <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-rose-500 font-bold text-xl z-10">
           L
         </div>
         <svg className="absolute inset-0 w-full h-full" viewBox="0 0 200 200">
           <path d="M 100 100 Q 120 160, 180 180" fill="none" stroke="#3b82f6" strokeWidth="3" />
           <polygon points="120,135 130,125 130,145" fill="#3b82f6" />
           <polygon points="150,155 160,145 160,165" fill="#3b82f6" />
         </svg>
         <svg className="absolute inset-0 w-full h-full" viewBox="0 0 200 200">
           <path d="M 100 100 Q 160 80, 180 40" fill="none" stroke="#f43f5e" strokeWidth="3" />
           <path d="M 130 90 A 10 10 0 0 0 145 80" fill="#f43f5e" />
           <path d="M 160 65 A 10 10 0 0 0 175 55" fill="#f43f5e" />
         </svg>
         <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-48 h-48 opacity-20 pointer-events-none mix-blend-screen"
              style={{
                background: 'radial-gradient(circle at 40% 40%, rgba(255,255,255,0.8) 0%, transparent 60%)',
                clipPath: 'polygon(0% 0%, 100% 0%, 100% 50%, 60% 100%, 0% 100%)'
              }}
         />
      </div>
      <div className="absolute bottom-2 right-3 text-[10px] text-amber-400 font-mono tracking-wider">
        Baroclinic Instability
      </div>
    </div>
  );
}
function EkmanSpiralAnimation() {
  return (
    <div className="w-full h-48 bg-dark-900 border border-dark-700 rounded-lg overflow-hidden relative flex items-center justify-center perspective-[1000px]">
      <div className="relative w-64 h-32 transform-style-3d rotate-x-[60deg] rotate-z-[-30deg] animate-[spinZ_20s_linear_infinite]">
        <div className="absolute top-0 left-0 w-full h-full border border-blue-500/20 bg-blue-500/5 translate-z-[80px]" />
        <div className="absolute top-0 left-0 w-full h-full border border-emerald-500/30 bg-emerald-500/10 translate-z-0" />
        {[...Array(8)].map((_, i) => {
          const z = i * 10;
          const length = 100 - i * 10;
          const rotation = i * 15;
          const opacity = 1 - (i * 0.1);
          return (
            <div 
              key={i} 
              className="absolute top-1/2 left-1/2 origin-left -translate-y-1/2 h-1 bg-amber-400 before:content-[''] before:absolute before:right-0 before:top-1/2 before:-translate-y-1/2 before:border-l-[6px] before:border-l-amber-400 before:border-y-[4px] before:border-y-transparent"
              style={{
                width: `${length}px`,
                transform: `translateZ(${80 - z}px) rotateZ(${rotation}deg)`,
                opacity: opacity
              }}
            />
          );
        })}
        <svg className="absolute top-0 left-0 w-full h-full overflow-visible" style={{ transform: 'translateZ(0) rotateX(-90deg)', transformOrigin: 'center' }}>
        </svg>
      </div>
      <div className="absolute bottom-2 right-3 text-[10px] text-amber-400 font-mono tracking-wider">
        {"u(z) = U_g(1 - e^{-az}cos(az))"}
      </div>
      <style>{`
        .transform-style-3d { transform-style: preserve-3d; }
        .rotate-x-\\[60deg\\] { transform: rotateX(60deg) rotateZ(-30deg); }
        .translate-z-\\[80px\\] { transform: translateZ(80px); }
        .translate-z-0 { transform: translateZ(0px); }
        @keyframes spinZ {
          from { transform: rotateX(60deg) rotateZ(0deg); }
          to { transform: rotateX(60deg) rotateZ(360deg); }
        }
      `}</style>
    </div>
  );
}
function GridResolutionAnimation() {
  const [isDiscrete, setIsDiscrete] = useState(false);
  useEffect(() => {
    const interval = setInterval(() => {
      setIsDiscrete(prev => !prev);
    }, 2000);
    return () => clearInterval(interval);
  }, []);
  return (
    <div className="w-full h-48 bg-dark-900 border border-dark-700 rounded-lg overflow-hidden relative flex items-center justify-center">
      <div className="absolute inset-0 opacity-20 pointer-events-none" 
           style={{ backgroundImage: 'linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)', backgroundSize: '20px 20px' }}>
      </div>
      <div className="relative w-full h-full flex items-center">
        <svg className={`absolute inset-0 w-full h-full transition-opacity duration-500 ${isDiscrete ? 'opacity-20' : 'opacity-100'}`} viewBox="0 0 400 200" preserveAspectRatio="none">
          <path d="M 0 100 Q 50 20, 100 100 T 200 100 T 300 100 T 400 100" fill="none" stroke="#a855f7" strokeWidth="4" className="animate-[slideLeft_4s_linear_infinite]" />
        </svg>
        <div className={`absolute inset-0 w-full h-full flex items-end transition-opacity duration-500 ${isDiscrete ? 'opacity-100' : 'opacity-0'}`}>
          {[...Array(20)].map((_, i) => {
            const h = 100 + Math.sin(i * 0.5) * 60;
            return (
               <div key={i} className="flex-1 border-r border-dark-900 bg-purple-500/80 transition-all duration-300" style={{ height: `${h}px` }} />
            )
          })}
        </div>
      </div>
      <div className="absolute top-2 left-3 text-[10px] text-purple-400 font-mono tracking-wider bg-dark-900/80 px-2 py-1 rounded">
        {isDiscrete ? "Finite Difference Grid (Δx)" : "Continuous Function"}
      </div>
      <style>{`
        @keyframes slideLeft {
          from { transform: translateX(0); }
          to { transform: translateX(-100px); } /* Assuming wave period is 100px */
        }
      `}</style>
    </div>
  );
}
function HadleyCellAnimation() {
  return (
    <div className="w-full h-48 bg-dark-900 border border-dark-700 rounded-lg overflow-hidden relative flex flex-col items-center justify-end perspective-[800px]">
      <div className="absolute top-8 w-full border-t border-dashed border-slate-600/50" />
      <div className="w-[150%] h-16 border-t-2 border-emerald-600/50 rounded-[50%] bg-dark-800 -mb-8 shadow-[0_-10px_30px_rgba(16,185,129,0.05)]" />
      <div className="absolute bottom-2 left-1/2 -translate-x-1/2 text-[10px] text-amber-500 font-bold uppercase tracking-widest bg-dark-900 px-2 rounded-full border border-dark-700 z-10">
        Equator
      </div>
      <div className="absolute bottom-2 left-1/4 text-[9px] text-blue-400 font-mono">-30°S</div>
      <div className="absolute bottom-2 right-1/4 text-[9px] text-blue-400 font-mono">+30°N</div>
      <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 400 200">
        <defs>
           <marker id="arrowRed" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
             <polygon points="0 0, 6 3, 0 6" fill="#f43f5e" />
           </marker>
           <marker id="arrowBlue" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
             <polygon points="0 0, 6 3, 0 6" fill="#3b82f6" />
           </marker>
           <marker id="arrowPurple" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
             <polygon points="0 0, 6 3, 0 6" fill="#a855f7" />
           </marker>
        </defs>
        <path d="M 200 170 C 200 100, 200 40, 220 30" fill="none" stroke="#f43f5e" strokeWidth="2" strokeDasharray="4 4" className="animate-[dash_2s_linear_infinite]" markerEnd="url(#arrowRed)" />
        <path d="M 220 30 C 250 20, 280 20, 300 40" fill="none" stroke="#a855f7" strokeWidth="2" strokeDasharray="4 4" className="animate-[dash_2s_linear_infinite]" markerEnd="url(#arrowPurple)" />
        <path d="M 300 40 C 310 80, 310 130, 290 160" fill="none" stroke="#3b82f6" strokeWidth="2" strokeDasharray="4 4" className="animate-[dash_2s_linear_infinite]" markerEnd="url(#arrowBlue)" />
        <path d="M 290 160 C 250 170, 220 170, 205 170" fill="none" stroke="#3b82f6" strokeWidth="2" strokeDasharray="4 4" className="animate-[dash_2s_linear_infinite]" markerEnd="url(#arrowBlue)" />
        <path d="M 200 170 C 200 100, 200 40, 180 30" fill="none" stroke="#f43f5e" strokeWidth="2" strokeDasharray="4 4" className="animate-[dash_2s_linear_infinite]" markerEnd="url(#arrowRed)" />
        <path d="M 180 30 C 150 20, 120 20, 100 40" fill="none" stroke="#a855f7" strokeWidth="2" strokeDasharray="4 4" className="animate-[dash_2s_linear_infinite]" markerEnd="url(#arrowPurple)" />
        <path d="M 100 40 C 90 80, 90 130, 110 160" fill="none" stroke="#3b82f6" strokeWidth="2" strokeDasharray="4 4" className="animate-[dash_2s_linear_infinite]" markerEnd="url(#arrowBlue)" />
        <path d="M 110 160 C 150 170, 180 170, 195 170" fill="none" stroke="#3b82f6" strokeWidth="2" strokeDasharray="4 4" className="animate-[dash_2s_linear_infinite]" markerEnd="url(#arrowBlue)" />
      </svg>
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 w-16 h-16 bg-rose-500/20 blur-xl rounded-full" />
      <style>{`
        @keyframes dash {
          to { stroke-dashoffset: -16; }
        }
      `}</style>
    </div>
  );
}
function KHInstabilityAnimation() {
  return (
    <div className="w-full h-48 bg-dark-900 border border-dark-700 rounded-lg overflow-hidden relative">
      <div className="absolute top-0 left-0 w-full h-1/2 bg-blue-500/10 flex items-center overflow-hidden">
         <div className="w-[200%] h-[2px] bg-gradient-to-r from-transparent via-blue-400 to-transparent animate-[slideRight_3s_linear_infinite]" />
      </div>
      <div className="absolute bottom-0 left-0 w-full h-1/2 bg-amber-500/10 flex items-center overflow-hidden">
         <div className="w-[200%] h-[2px] bg-gradient-to-r from-transparent via-amber-400 to-transparent animate-[slideLeft_3s_linear_infinite]" />
      </div>
      <svg className="absolute top-1/2 left-0 w-[200%] h-32 -translate-y-1/2 animate-[slideLeft_4s_linear_infinite]" viewBox="0 0 1000 100" preserveAspectRatio="none">
        <path 
          d="M 0 50 Q 50 10, 100 50 T 200 50 T 300 50 T 400 50 T 500 50 T 600 50 T 700 50 T 800 50 T 900 50 T 1000 50" 
          fill="none" 
          stroke="rgba(255,255,255,0.2)" 
          strokeWidth="2"
        />
        {[...Array(10)].map((_, i) => (
          <g key={i} transform={`translate(${i * 100}, 50)`}>
            <path d="M 30 0 C 60 -40, 80 20, 50 30 C 20 40, 0 0, 30 0" fill="none" stroke="#60a5fa" strokeWidth="2" className="animate-[spin_4s_linear_infinite]" style={{ transformOrigin: '50px 0px' }} />
          </g>
        ))}
      </svg>
      <div className="absolute bottom-2 right-3 text-[10px] text-blue-400 font-mono tracking-wider">
        Ri &lt; 0.25
      </div>
      <style>{`
        @keyframes slideRight {
          from { transform: translateX(-50%); }
          to { transform: translateX(0%); }
        }
        @keyframes slideLeft {
          from { transform: translateX(0%); }
          to { transform: translateX(-50%); }
        }
      `}</style>
    </div>
  );
}
function RossbyWaveAnimation() {
  return (
    <div className="w-full h-48 bg-dark-900 border border-dark-700 rounded-lg overflow-hidden relative flex items-center justify-center">
      <div className="absolute inset-0 w-full h-full opacity-10 flex flex-col justify-between">
        {[...Array(5)].map((_, i) => (
           <div key={i} className="w-full h-[1px] bg-white border-dashed border-b" />
        ))}
      </div>
      <svg className="absolute w-[200%] h-full left-0 animate-[slideLeft_6s_linear_infinite]" viewBox="0 0 200 100" preserveAspectRatio="none">
        <path d="M 0 0 L 200 0 L 200 50 Q 175 10, 150 50 T 100 50 T 50 50 T 0 50 Z" fill="rgba(96, 165, 250, 0.15)" />
        <path d="M 0 100 L 200 100 L 200 50 Q 175 10, 150 50 T 100 50 T 50 50 T 0 50 Z" fill="rgba(244, 63, 94, 0.15)" />
        <path 
          d="M 0 50 Q 25 90, 50 50 T 100 50 T 150 50 T 200 50" 
          fill="none" 
          stroke="#00f0ff" 
          strokeWidth="3" 
          strokeDasharray="5 5"
          className="animate-[dash_2s_linear_infinite]"
        />
        <path 
          d="M 0 50 Q 25 90, 50 50 T 100 50 T 150 50 T 200 50" 
          fill="none" 
          stroke="rgba(0, 240, 255, 0.3)" 
          strokeWidth="8" 
        />
      </svg>
      <div className="absolute bottom-2 right-3 text-[10px] text-cyan-400 font-mono tracking-wider">
        c = u - β/(k² + l²)
      </div>
      <style>{`
        @keyframes slideLeft {
          from { transform: translateX(0%); }
          to { transform: translateX(-50%); }
        }
        @keyframes dash {
          to { stroke-dashoffset: -20; }
        }
      `}</style>
    </div>
  );
}
function ThermalConvectionAnimation() {
  return (
    <div className="w-full h-48 bg-dark-900 border border-dark-700 rounded-lg overflow-hidden relative flex items-center justify-center">
      <div className="absolute inset-0 bg-gradient-to-b from-cyan-900/20 to-rose-900/20" />
      <div className="absolute bottom-0 w-full h-2 bg-rose-500/50 blur-sm" />
      <div className="absolute top-0 w-full h-2 bg-cyan-500/50 blur-sm" />
      <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 400 200">
        <defs>
          <marker id="arrowUp" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
            <polygon points="0 0, 6 3, 0 6" fill="#f43f5e" />
          </marker>
          <marker id="arrowDown" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
            <polygon points="0 0, 6 3, 0 6" fill="#06b6d4" />
          </marker>
        </defs>
        <path d="M 200 180 C 200 100, 200 40, 150 40 C 100 40, 100 100, 100 180" fill="none" stroke="#f43f5e" strokeWidth="2" strokeDasharray="4 4" className="animate-[dash_2s_linear_infinite]" markerEnd="url(#arrowUp)" />
        <path d="M 100 180 C 100 200, 150 200, 200 180" fill="none" stroke="#06b6d4" strokeWidth="2" strokeDasharray="4 4" className="animate-[dash_2s_linear_infinite]" markerEnd="url(#arrowDown)" />
        <path d="M 200 180 C 200 100, 200 40, 250 40 C 300 40, 300 100, 300 180" fill="none" stroke="#f43f5e" strokeWidth="2" strokeDasharray="4 4" className="animate-[dash_2s_linear_infinite]" markerEnd="url(#arrowUp)" />
        <path d="M 300 180 C 300 200, 250 200, 200 180" fill="none" stroke="#06b6d4" strokeWidth="2" strokeDasharray="4 4" className="animate-[dash_2s_linear_infinite]" markerEnd="url(#arrowDown)" />
      </svg>
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
         {[...Array(4)].map((_, i) => (
            <div key={i} className="absolute bottom-0 w-6 h-6 bg-rose-500/30 rounded-full blur-md animate-[rise_4s_ease-in-infinite]" 
                 style={{ left: '50%', transform: 'translateX(-50%)', animationDelay: `${i * 1.5}s` }} />
         ))}
      </div>
      <div className="absolute bottom-2 right-3 text-[10px] text-rose-400 font-mono tracking-wider">
        Q = hA(T_s - T_∞)
      </div>
      <style>{`
        @keyframes dash {
          to { stroke-dashoffset: -16; }
        }
        @keyframes rise {
          0% { transform: translateX(-50%) translateY(0) scale(0.5); opacity: 0; }
          20% { opacity: 1; }
          80% { opacity: 1; }
          100% { transform: translateX(-50%) translateY(-180px) scale(1.5); opacity: 0; }
          }
      `}</style>
    </div>
  );
}
function VorticityAnimation() {
  return (
    <div className="w-full h-48 bg-dark-900 border border-dark-700 rounded-lg overflow-hidden relative flex items-center justify-center">
      <div className="absolute inset-0 opacity-20 pointer-events-none">
        {[...Array(6)].map((_, i) => (
          <div key={i} className="absolute h-[1px] bg-gradient-to-r from-transparent via-purple-500 to-transparent w-full animate-[slideRight_4s_linear_infinite]"
               style={{ top: `${(i + 1) * 16}%`, animationDelay: `${i * 0.5}s` }}>
          </div>
        ))}
      </div>
      <div className="relative w-24 h-24">
        <div className="absolute inset-0 rounded-full border-2 border-purple-500/30 animate-[spin_3s_linear_infinite]">
          <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 w-3 h-3 bg-purple-400 rounded-full shadow-[0_0_10px_#c084fc]" />
          <div className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2 w-3 h-3 bg-blue-400 rounded-full shadow-[0_0_10px_#60a5fa]" />
          <div className="absolute top-1/2 left-0 -translate-x-1/2 -translate-y-1/2 w-3 h-3 bg-emerald-400 rounded-full shadow-[0_0_10px_#34d399]" />
          <div className="absolute top-1/2 right-0 translate-x-1/2 -translate-y-1/2 w-3 h-3 bg-amber-400 rounded-full shadow-[0_0_10px_#fbbf24]" />
        </div>
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-2 h-2 bg-white rounded-full shadow-[0_0_8px_white]" />
        <svg className="absolute inset-0 w-full h-full animate-[spin_3s_linear_infinite]" viewBox="0 0 100 100">
           <defs>
             <marker id="arrowhead" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
               <polygon points="0 0, 6 3, 0 6" fill="#c084fc" />
             </marker>
           </defs>
           <path d="M 50 15 A 35 35 0 0 1 85 50" fill="none" stroke="#c084fc" strokeWidth="2" strokeDasharray="4 4" markerEnd="url(#arrowhead)" />
           <path d="M 50 85 A 35 35 0 0 1 15 50" fill="none" stroke="#c084fc" strokeWidth="2" strokeDasharray="4 4" markerEnd="url(#arrowhead)" />
        </svg>
      </div>
      <div className="absolute bottom-2 right-3 text-[10px] text-purple-400 font-mono tracking-wider">
        ζ = ∇ × v
      </div>
    </div>
  );
}
interface AerodynamicsProps {