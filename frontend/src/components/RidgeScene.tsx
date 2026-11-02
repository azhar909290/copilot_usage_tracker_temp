"use client";

import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo, useRef, type RefObject } from "react";
import * as THREE from "three";

const WIDTH = 6.4;
const HEIGHT = 1.55;
const ELEVATION = 0.52;
const DURATION = 1100;
/** Screen gutters (px) kept free for the HTML day labels on the left and time labels below. */
const GUTTER = { left: 62, right: 26, top: 10, bottom: 30 };

export type RidgeColors = { surface: string; ink: string; front: string; accent: string };

export type RidgeSceneProps = {
  rows: number[][];
  max: number;
  /** Row drawn in the accent when nothing is hovered (the newest day). */
  accentRow: number | null;
  highlight: number | null;
  colors: RidgeColors;
  reducedMotion: boolean;
  labelLayer: RefObject<HTMLDivElement | null>;
  onHover: (row: number, minute: number) => void;
  onSelect: (row: number) => void;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const easeOut = (t: number) => 1 - Math.pow(1 - t, 4);

function layout(count: number) {
  const spacing = count > 1 ? clamp(4.2 / (count - 1), 0.04, 0.6) : 0;
  return { spacing, depth: spacing * Math.max(0, count - 1) };
}

function orbit(camera: THREE.PerspectiveCamera, target: THREE.Vector3, distance: number, yaw: number, elevation: number) {
  camera.position.set(
    target.x + Math.sin(yaw) * Math.cos(elevation) * distance,
    target.y + Math.sin(elevation) * distance,
    target.z + Math.cos(yaw) * Math.cos(elevation) * distance,
  );
  camera.lookAt(target);
  camera.updateMatrixWorld();
}

/**
 * Finds a camera target and distance that place the ridges' real extent (baselines plus each
 * row's tallest peak) inside the canvas minus the label gutters.
 */
function fitView(
  camera: THREE.PerspectiveCamera,
  points: THREE.Vector3[],
  width: number,
  height: number,
  depth: number,
) {
  const target = new THREE.Vector3(0, HEIGHT * 0.35, -depth / 2);
  let distance = 9;
  const goal = {
    minX: -1 + (2 * GUTTER.left) / width,
    maxX: 1 - (2 * GUTTER.right) / width,
    minY: -1 + (2 * GUTTER.bottom) / height,
    maxY: 1 - (2 * GUTTER.top) / height,
  };
  const right = new THREE.Vector3();
  const up = new THREE.Vector3();
  const probe = new THREE.Vector3();
  for (let pass = 0; pass < 6; pass += 1) {
    orbit(camera, target, distance, 0, ELEVATION);
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const point of points) {
      probe.copy(point).project(camera);
      minX = Math.min(minX, probe.x);
      maxX = Math.max(maxX, probe.x);
      minY = Math.min(minY, probe.y);
      maxY = Math.max(maxY, probe.y);
    }
    const scale = Math.max((maxX - minX) / (goal.maxX - goal.minX), (maxY - minY) / (goal.maxY - goal.minY));
    const halfHeight = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * distance;
    const halfWidth = halfHeight * camera.aspect;
    camera.matrixWorld.extractBasis(right, up, probe);
    target
      .addScaledVector(right, ((minX + maxX) / 2 - (goal.minX + goal.maxX) / 2 * scale) * halfWidth)
      .addScaledVector(up, ((minY + maxY) / 2 - (goal.minY + goal.maxY) / 2 * scale) * halfHeight);
    distance *= scale;
  }
  return { target, distance };
}

function Ridges({
  rows,
  max,
  accentRow,
  highlight,
  colors,
  reducedMotion,
  labelLayer,
  onHover,
  onSelect,
}: RidgeSceneProps) {
  const camera = useThree((state) => state.camera) as THREE.PerspectiveCamera;
  const size = useThree((state) => state.size);
  const gl = useThree((state) => state.gl);
  const invalidate = useThree((state) => state.invalidate);
  const count = rows.length;
  const samples = rows[0]?.length ?? 0;
  const { spacing, depth } = layout(count);
  const heights = useRef<Float32Array[]>([]);
  const animation = useRef<{ from: Float32Array[]; to: Float32Array[]; start: number } | null>(null);
  const view = useRef({ yaw: 0, pitch: 0, inside: false });
  const projected = useMemo(() => new THREE.Vector3(), []);
  const fit = useRef<{ key: string; points: THREE.Vector3[]; target: THREE.Vector3; distance: number } | null>(null);

  const fitPoints = useMemo(
    () =>
      rows.flatMap((row, index) => {
        const z = -depth + index * spacing;
        let peak = 0;
        let at = 0;
        row.forEach((value, sample) => {
          if (value > peak) {
            peak = value;
            at = sample;
          }
        });
        const points = [new THREE.Vector3(-WIDTH / 2, 0, z), new THREE.Vector3(WIDTH / 2, 0, z)];
        if (peak > 0 && max > 0) {
          points.push(new THREE.Vector3(-WIDTH / 2 + (at / Math.max(1, row.length - 1)) * WIDTH, (peak / max) * HEIGHT, z));
        }
        return points;
      }),
    [rows, max, depth, spacing],
  );

  const scene = useMemo(() => {
    const curtainMaterial = new THREE.MeshBasicMaterial({
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });
    const index: number[] = [];
    for (let sample = 0; sample < samples - 1; sample += 1) {
      const top = sample * 2;
      index.push(top, top + 1, top + 2, top + 2, top + 1, top + 3);
    }
    const ridges = Array.from({ length: count }, (_, row) => {
      const z = -depth + row * spacing;
      const linePositions = new Float32Array(samples * 3);
      const curtainPositions = new Float32Array(samples * 6);
      for (let sample = 0; sample < samples; sample += 1) {
        const x = -WIDTH / 2 + (sample / Math.max(1, samples - 1)) * WIDTH;
        linePositions.set([x, 0, z], sample * 3);
        curtainPositions.set([x, 0, z, x, 0, z], sample * 6);
      }
      const lineGeometry = new THREE.BufferGeometry();
      lineGeometry.setAttribute("position", new THREE.BufferAttribute(linePositions, 3));
      const curtainGeometry = new THREE.BufferGeometry();
      curtainGeometry.setAttribute("position", new THREE.BufferAttribute(curtainPositions, 3));
      curtainGeometry.setIndex(index);
      const line = new THREE.Line(lineGeometry, new THREE.LineBasicMaterial({ transparent: true }));
      const curtain = new THREE.Mesh(curtainGeometry, curtainMaterial);
      line.frustumCulled = false;
      curtain.frustumCulled = false;
      curtain.userData.row = row;
      return { line, curtain, linePositions, curtainPositions };
    });
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(WIDTH + 0.6, depth + 0.9),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, 0, -depth / 2);
    return { ridges, curtainMaterial, floor };
  }, [count, samples, depth, spacing]);

  useEffect(
    () => () => {
      for (const ridge of scene.ridges) {
        ridge.line.geometry.dispose();
        (ridge.line.material as THREE.Material).dispose();
        ridge.curtain.geometry.dispose();
      }
      scene.curtainMaterial.dispose();
      scene.floor.geometry.dispose();
      (scene.floor.material as THREE.Material).dispose();
    },
    [scene],
  );

  function writeHeights(values: Float32Array[]) {
    scene.ridges.forEach((ridge, row) => {
      const source = values[row];
      for (let sample = 0; sample < samples; sample += 1) {
        const y = (source?.[sample] ?? 0) * HEIGHT;
        ridge.linePositions[sample * 3 + 1] = y;
        ridge.curtainPositions[sample * 6 + 1] = y;
      }
      ridge.line.geometry.attributes.position.needsUpdate = true;
      ridge.curtain.geometry.attributes.position.needsUpdate = true;
      ridge.curtain.geometry.computeBoundingSphere();
    });
  }

  useEffect(() => {
    const targets = rows.map((row) => Float32Array.from(row, (value) => (max > 0 ? value / max : 0)));
    const reusable = heights.current.length === count && heights.current[0]?.length === samples;
    const start = reusable ? heights.current.map((row) => row.slice()) : targets.map((row) => new Float32Array(row.length));
    if (reducedMotion) {
      heights.current = targets;
      animation.current = null;
      writeHeights(targets);
    } else {
      heights.current = start;
      animation.current = { from: start, to: targets, start: performance.now() };
      writeHeights(start);
    }
    invalidate();
    // writeHeights only touches the memoised scene, which is covered by `scene`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, max, count, samples, reducedMotion, scene, invalidate]);

  useEffect(() => {
    const ink = new THREE.Color(colors.ink);
    const front = new THREE.Color(colors.front);
    const accent = new THREE.Color(colors.accent);
    scene.curtainMaterial.color.set(colors.surface);
    scene.ridges.forEach((ridge, row) => {
      const material = ridge.line.material as THREE.LineBasicMaterial;
      const near = count > 1 ? row / (count - 1) : 1;
      const resting = 0.3 + 0.7 * Math.pow(near, 1.1);
      const isAccent = highlight !== null ? row === highlight : row === accentRow;
      material.color.copy(isAccent ? accent : ink.clone().lerp(front, Math.pow(near, 0.8)));
      material.opacity = isAccent ? 1 : highlight !== null ? resting * 0.42 : resting;
    });
    invalidate();
  }, [scene, colors, highlight, accentRow, count, invalidate]);

  useEffect(() => {
    const element = gl.domElement;
    const enter = () => {
      view.current.inside = true;
      invalidate();
    };
    const leave = () => {
      view.current.inside = false;
      invalidate();
    };
    element.addEventListener("pointerenter", enter);
    element.addEventListener("pointerleave", leave);
    element.addEventListener("pointermove", enter);
    return () => {
      element.removeEventListener("pointerenter", enter);
      element.removeEventListener("pointerleave", leave);
      element.removeEventListener("pointermove", enter);
    };
  }, [gl, invalidate]);

  useEffect(() => invalidate(), [size.width, size.height, invalidate]);

  useFrame((state, rawDelta) => {
    const delta = Math.min(rawDelta, 1 / 30);
    let busy = false;

    const running = animation.current;
    if (running) {
      const elapsed = performance.now() - running.start;
      const stagger = Math.min(38, 640 / Math.max(1, count));
      let finished = true;
      heights.current = running.to.map((target, row) => {
        const t = clamp((elapsed - (count - 1 - row) * stagger) / DURATION, 0, 1);
        if (t < 1) finished = false;
        const eased = easeOut(t);
        const from = running.from[row];
        return target.map((value, sample) => (from?.[sample] ?? 0) + (value - (from?.[sample] ?? 0)) * eased);
      });
      writeHeights(heights.current);
      if (finished) animation.current = null;
      else busy = true;
    }

    const key = `${size.width}x${size.height}`;
    if (!fit.current || fit.current.key !== key || fit.current.points !== fitPoints) {
      fit.current = { key, points: fitPoints, ...fitView(camera, fitPoints, size.width, size.height, depth) };
    }

    const pointer = state.pointer;
    const goal = !reducedMotion && view.current.inside ? { yaw: pointer.x * 0.08, pitch: pointer.y * 0.04 } : { yaw: 0, pitch: 0 };
    const ease = 1 - Math.exp(-delta * 6);
    view.current.yaw += (goal.yaw - view.current.yaw) * ease;
    view.current.pitch += (goal.pitch - view.current.pitch) * ease;
    if (Math.abs(goal.yaw - view.current.yaw) > 1e-4 || Math.abs(goal.pitch - view.current.pitch) > 1e-4) busy = true;

    orbit(camera, fit.current.target, fit.current.distance, view.current.yaw, ELEVATION + view.current.pitch);

    const layer = labelLayer.current;
    if (layer) {
      for (const element of Array.from(layer.children) as HTMLElement[]) {
        const row = element.dataset.row;
        const minute = element.dataset.minute;
        if (row !== undefined) projected.set(-WIDTH / 2 - 0.12, 0, -depth + Number(row) * spacing);
        else if (minute !== undefined) projected.set(-WIDTH / 2 + (Number(minute) / 1440) * WIDTH, 0, 0.14);
        else continue;
        projected.project(camera);
        const x = ((projected.x + 1) / 2) * size.width;
        const y = ((1 - projected.y) / 2) * size.height;
        element.style.transform =
          row !== undefined
            ? `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-100%, -50%)`
            : `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, 6px)`;
      }
    }

    if (busy) invalidate();
  });

  function locate(event: ThreeEvent<PointerEvent | MouseEvent>) {
    const hitRow = event.object.userData.row as number | undefined;
    const row = hitRow ?? clamp(Math.round((event.point.z + depth) / (spacing || 1)), 0, count - 1);
    const minute = clamp(((event.point.x + WIDTH / 2) / WIDTH) * 1440, 0, 1439.99);
    return { row, minute };
  }

  const handlers = {
    onPointerMove: (event: ThreeEvent<PointerEvent>) => {
      event.stopPropagation();
      const { row, minute } = locate(event);
      onHover(row, minute);
    },
    onClick: (event: ThreeEvent<MouseEvent>) => {
      event.stopPropagation();
      onSelect(locate(event).row);
    },
  };

  return (
    <group>
      <primitive object={scene.floor} {...handlers} />
      {scene.ridges.map((ridge, row) => (
        <group key={row}>
          <primitive object={ridge.curtain} {...handlers} />
          <primitive object={ridge.line} />
        </group>
      ))}
    </group>
  );
}

export default function RidgeScene(props: RidgeSceneProps) {
  return (
    <Canvas
      className="ridge-canvas"
      frameloop="demand"
      flat
      dpr={[1, 2]}
      gl={{ antialias: true, alpha: true, powerPreference: "low-power" }}
      camera={{ fov: 24, near: 0.1, far: 80, position: [0, 3, 8] }}
    >
      <Ridges {...props} />
    </Canvas>
  );
}
