"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";

export type LandingSceneProps = {
  colors: { calls: string; tokens: string; cost: string; rose: string; lime: string; sky: string; text: string };
  light: boolean;
  agents: number;
  reducedMotion: boolean;
  running: boolean;
};

const PLANE_Y = [-1.25, -0.25, 0.75];
const CORE_Y = 2.15;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const easeOut = (t: number) => 1 - Math.pow(1 - clamp(t, 0, 1), 4);

function seeded(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function glowTexture() {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d")!;
  const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.3, "rgba(255,255,255,0.45)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** A square control plane: translucent fill, a fine grid and a brighter rim. */
function ControlPlane({ color, light }: { color: string; light: boolean }) {
  const grid = useMemo(() => {
    const helper = new THREE.GridHelper(5.4, 18, color, color);
    const material = helper.material as THREE.LineBasicMaterial;
    material.transparent = true;
    material.opacity = light ? 0.35 : 0.22;
    material.depthWrite = false;
    return helper;
  }, [color, light]);
  const rim = useMemo(() => {
    const half = 2.7;
    const points = [
      new THREE.Vector3(-half, 0, -half),
      new THREE.Vector3(half, 0, -half),
      new THREE.Vector3(half, 0, half),
      new THREE.Vector3(-half, 0, half),
    ];
    return new THREE.BufferGeometry().setFromPoints(points);
  }, []);
  useEffect(
    () => () => {
      grid.geometry.dispose();
      (grid.material as THREE.Material).dispose();
      rim.dispose();
    },
    [grid, rim],
  );
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[5.4, 5.4]} />
        <meshBasicMaterial color={color} transparent opacity={light ? 0.1 : 0.07} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      <primitive object={grid} />
      <lineLoop geometry={rim}>
        <lineBasicMaterial color={color} transparent opacity={0.9} />
      </lineLoop>
    </group>
  );
}

function Scene({ colors, light, agents, reducedMotion, running }: LandingSceneProps) {
  const camera = useThree((state) => state.camera) as THREE.PerspectiveCamera;
  const size = useThree((state) => state.size);
  const invalidate = useThree((state) => state.invalidate);
  const started = useRef(0);
  const rootRef = useRef<THREE.Group>(null);
  const coreRef = useRef<THREE.Group>(null);
  const planeRefs = useRef<(THREE.Group | null)[]>([]);
  const nodeRefs = useRef<(THREE.Mesh | null)[]>([]);
  const particlesRef = useRef<THREE.Points>(null);
  const beamsRef = useRef<THREE.LineSegments>(null);
  const parallax = useRef({ x: 0, y: 0 });
  const texture = useMemo(() => glowTexture(), []);
  useEffect(() => () => texture.dispose(), [texture]);
  useEffect(() => {
    started.current = performance.now();
    invalidate();
  }, [invalidate]);

  const family = useMemo(() => [colors.calls, colors.tokens, colors.cost, colors.lime, colors.rose], [colors]);
  const count = clamp(agents || 63, 12, 90);
  const nodes = useMemo(() => {
    const random = seeded(63);
    return Array.from({ length: count }, (_, index) => {
      const ring = index % 4;
      const radius = 1.25 + ring * 0.42 + random() * 0.18;
      const angle = (index / count) * Math.PI * 2 * 3 + random() * 0.4;
      return {
        radius,
        angle,
        speed: 0.08 + (3 - ring) * 0.035,
        height: 1.15 + random() * 0.55,
        color: family[index % family.length],
        phase: random() * Math.PI * 2,
        size: 0.045 + random() * 0.05,
      };
    });
  }, [count, family]);

  const particles = useMemo(() => {
    const random = seeded(7);
    const total = 140;
    const positions = new Float32Array(total * 3);
    const colorsArray = new Float32Array(total * 3);
    const seeds = Array.from({ length: total }, (_, index) => ({ node: index % count, t: random(), speed: 0.18 + random() * 0.35 }));
    const tint = new THREE.Color();
    seeds.forEach((seed, index) => {
      tint.set(family[seed.node % family.length]);
      colorsArray.set([tint.r, tint.g, tint.b], index * 3);
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colorsArray, 3));
    // Particle progress lives on the geometry so the frame loop mutates it through the object ref.
    geometry.userData.seeds = seeds;
    return { geometry };
  }, [count, family]);
  const beams = useMemo(() => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(count * 6), 3));
    return geometry;
  }, [count]);
  const stars = useMemo(() => {
    const random = seeded(11);
    const positions = new Float32Array(500 * 3);
    for (let index = 0; index < 500; index += 1) {
      const radius = 14 + random() * 12;
      const theta = random() * Math.PI * 2;
      const phi = Math.acos(2 * random() - 1);
      positions.set([radius * Math.sin(phi) * Math.cos(theta), radius * Math.cos(phi) * 0.6, radius * Math.sin(phi) * Math.sin(theta)], index * 3);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    return geometry;
  }, []);
  useEffect(
    () => () => {
      particles.geometry.dispose();
      beams.dispose();
      stars.dispose();
    },
    [particles, beams, stars],
  );

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      parallax.current = { x: (event.clientX / window.innerWidth) * 2 - 1, y: (event.clientY / window.innerHeight) * 2 - 1 };
      invalidate();
    };
    window.addEventListener("pointermove", onMove);
    return () => window.removeEventListener("pointermove", onMove);
  }, [invalidate]);

  const position = useMemo(() => new THREE.Vector3(), []);
  const look = useMemo(() => new THREE.Vector3(0, 0.55, 0), []);

  useFrame((state, rawDelta) => {
    const delta = Math.min(rawDelta, 1 / 20);
    const elapsed = reducedMotion ? 1e6 : performance.now() - started.current;
    const time = reducedMotion ? 0 : state.clock.elapsedTime;

    if (rootRef.current) rootRef.current.rotation.y = reducedMotion ? 0.5 : 0.5 + time * 0.07;
    planeRefs.current.forEach((plane, index) => {
      if (!plane) return;
      const t = easeOut((elapsed - index * 180) / 1400);
      plane.position.y = PLANE_Y[index] - (1 - t) * 2.4 + Math.sin(time * 0.8 + index) * 0.04;
      plane.scale.setScalar(0.85 + 0.15 * t);
      plane.visible = t > 0.001;
    });
    if (coreRef.current) {
      const t = easeOut((elapsed - 650) / 1000);
      coreRef.current.scale.setScalar(0.6 + 0.4 * t);
      coreRef.current.position.y = CORE_Y + Math.sin(time * 1.2) * 0.08;
      coreRef.current.rotation.y = time * 0.6;
      coreRef.current.rotation.x = time * 0.25;
      coreRef.current.visible = t > 0.001;
    }

    const beamGeometry = beamsRef.current?.geometry;
    const beamAttribute = beamGeometry?.attributes.position as THREE.BufferAttribute | undefined;
    const reveal = easeOut((elapsed - 900) / 1200);
    nodes.forEach((node, index) => {
      const mesh = nodeRefs.current[index];
      const angle = node.angle + time * node.speed;
      position.set(Math.cos(angle) * node.radius * reveal, node.height + Math.sin(time * 1.3 + node.phase) * 0.07, Math.sin(angle) * node.radius * reveal);
      if (mesh) {
        mesh.position.copy(position);
        mesh.rotation.set(time + node.phase, time * 0.7, 0);
        mesh.scale.setScalar(0.4 + 0.6 * reveal);
      }
      beamAttribute?.setXYZ(index * 2, position.x, position.y, position.z);
      beamAttribute?.setXYZ(index * 2 + 1, 0, CORE_Y, 0);
    });
    const beamsObject = beamsRef.current;
    if (beamsObject) {
      beamsObject.geometry.attributes.position.needsUpdate = true;
      (beamsObject.material as THREE.LineBasicMaterial).opacity = (light ? 0.22 : 0.14) * reveal;
    }

    const particleObject = particlesRef.current;
    const seeds = (particleObject?.geometry.userData.seeds ?? []) as { node: number; t: number; speed: number }[];
    const particleAttribute = particleObject?.geometry.attributes.position as THREE.BufferAttribute | undefined;
    seeds.forEach((seed, index) => {
      if (!reducedMotion) seed.t = (seed.t + delta * seed.speed) % 1;
      const node = nodes[seed.node];
      const angle = node.angle + time * node.speed;
      const x = Math.cos(angle) * node.radius * reveal;
      const z = Math.sin(angle) * node.radius * reveal;
      const t = seed.t;
      particleAttribute?.setXYZ(index, x * (1 - t), node.height + (CORE_Y - node.height) * t + Math.sin(t * Math.PI) * 0.25, z * (1 - t));
    });
    if (particleObject) {
      particleObject.geometry.attributes.position.needsUpdate = true;
      (particleObject.material as THREE.PointsMaterial).opacity = 0.9 * reveal;
    }

    const aspect = size.width / Math.max(1, size.height);
    const distance = aspect < 0.9 ? 13.5 : aspect < 1.25 ? 11.5 : 10.2;
    const goalX = parallax.current.x * 0.9;
    const goalY = 4.2 - parallax.current.y * 0.6;
    const follow = reducedMotion ? 1 : 1 - Math.exp(-delta * 2.5);
    const { x, y, z } = camera.position;
    camera.position.set(x + (goalX - x) * follow, y + (goalY - y) * follow, z + (distance - z) * follow);
    camera.lookAt(look);

    if (running && !reducedMotion) invalidate();
    else if (elapsed < 3000) invalidate();
  });

  const blending = light ? THREE.NormalBlending : THREE.AdditiveBlending;
  const planeColors = [colors.cost, colors.tokens, colors.calls];
  return (
    <>
      <points geometry={stars}>
        <pointsMaterial color={colors.text} size={0.05} sizeAttenuation transparent opacity={light ? 0.25 : 0.45} depthWrite={false} />
      </points>
      <group ref={rootRef}>
        {planeColors.map((color, index) => (
          <group
            key={index}
            ref={(node) => {
              planeRefs.current[index] = node;
            }}
            position={[0, PLANE_Y[index], 0]}
          >
            <ControlPlane color={color} light={light} />
          </group>
        ))}
        <mesh position={[0, (PLANE_Y[0] + CORE_Y) / 2, 0]}>
          <cylinderGeometry args={[0.025, 0.025, CORE_Y - PLANE_Y[0], 8]} />
          <meshBasicMaterial color={colors.calls} transparent opacity={0.5} />
        </mesh>
        <lineSegments ref={beamsRef} geometry={beams}>
          <lineBasicMaterial color={colors.tokens} transparent opacity={0} depthWrite={false} />
        </lineSegments>
        {nodes.map((node, index) => (
          <mesh
            key={index}
            ref={(mesh) => {
              nodeRefs.current[index] = mesh;
            }}
          >
            <octahedronGeometry args={[node.size, 0]} />
            <meshBasicMaterial color={node.color} />
          </mesh>
        ))}
        <points ref={particlesRef} geometry={particles.geometry}>
          <pointsMaterial size={0.07} vertexColors transparent opacity={0} depthWrite={false} blending={blending} map={texture} />
        </points>
        <group ref={coreRef} position={[0, CORE_Y, 0]}>
          <mesh>
            <icosahedronGeometry args={[0.62, 1]} />
            <meshBasicMaterial color={colors.tokens} wireframe transparent opacity={0.8} />
          </mesh>
          <mesh>
            <icosahedronGeometry args={[0.36, 0]} />
            <meshBasicMaterial color={colors.calls} />
          </mesh>
          <mesh rotation={[Math.PI / 2.3, 0, 0]}>
            <torusGeometry args={[0.92, 0.012, 8, 96]} />
            <meshBasicMaterial color={colors.cost} />
          </mesh>
          <sprite scale={[3.6, 3.6, 1]}>
            <spriteMaterial map={texture} color={colors.tokens} transparent opacity={light ? 0.35 : 0.75} depthWrite={false} blending={blending} />
          </sprite>
        </group>
      </group>
    </>
  );
}

export default function LandingScene(props: LandingSceneProps) {
  return (
    <Canvas
      className="landing-canvas"
      frameloop="demand"
      dpr={[1, 2]}
      gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
      camera={{ fov: 36, near: 0.1, far: 120, position: [0, 4.2, 11] }}
    >
      <Scene {...props} />
    </Canvas>
  );
}
