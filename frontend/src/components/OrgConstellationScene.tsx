"use client";

import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo, useRef, type RefObject } from "react";
import * as THREE from "three";
import { useCappedInvalidate } from "@/lib/animation";

export type ConstellationMember = { user: string; tokens: number; requests: number; cost: number };
export type ConstellationTeam = {
  name: string;
  color: string;
  tokens: number;
  requests: number;
  members: ConstellationMember[];
};
export type ConstellationHover =
  | { kind: "org" }
  | { kind: "team"; team: string }
  | { kind: "member"; team: string; user: string };

export type ConstellationSceneProps = {
  teams: ConstellationTeam[];
  coreColors: [string, string, string];
  starColor: string;
  light: boolean;
  selected: string | null;
  reducedMotion: boolean;
  running: boolean;
  labelLayer: RefObject<HTMLDivElement | null>;
  onHover: (hover: ConstellationHover | null) => void;
  onSelect: (team: string | null) => void;
  onPickMember: (team: string, user: string) => void;
};

const ORBIT = 3.9;
const PITCH = 0.52;
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
  gradient.addColorStop(0.25, "rgba(255,255,255,0.55)");
  gradient.addColorStop(0.6, "rgba(255,255,255,0.12)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** A member badge: their initial on a disc ringed in the team colour, drawn once per person. */
function avatarTexture(name: string, color: string, light: boolean) {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d")!;
  const center = size / 2;

  // Outer glow ring
  context.beginPath();
  context.arc(center, center, center - 6, 0, Math.PI * 2);
  context.fillStyle = light ? "#ffffff" : "#0d1122";
  context.fill();

  context.lineWidth = 8;
  context.strokeStyle = color;
  context.stroke();

  // Inner subtle accent circle
  context.beginPath();
  context.arc(center, center, center - 18, 0, Math.PI * 2);
  context.lineWidth = 2;
  context.globalAlpha = 0.38;
  context.strokeStyle = color;
  context.stroke();
  context.globalAlpha = 1;

  // Extract clean initial
  const letter = name.replace(/^user-/, "").match(/[\p{L}\p{N}]/u)?.[0]?.toUpperCase() ?? "?";
  context.fillStyle = light ? "#0f172a" : color;
  context.font = `700 56px "Instrument Sans", system-ui, sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(letter, center, center + 3);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

type FadeMaterial = THREE.Material & { opacity: number; userData: { base?: number } };
const fadeCache = new WeakMap<THREE.Object3D, FadeMaterial[]>();

function fadeMaterials(root: THREE.Object3D) {
  let list = fadeCache.get(root);
  if (!list) {
    list = [];
    root.traverse((child) => {
      const material = (child as THREE.Mesh).material as FadeMaterial | undefined;
      if (material && "opacity" in material) list!.push(material);
    });
    fadeCache.set(root, list);
  }
  return list;
}

const noHit = () => {};

type MemberLayout = {
  offsetX: number;
  offsetZ: number;
  height: number;
  size: number;
  active: boolean;
};

function Constellation({
  teams,
  coreColors,
  starColor,
  light,
  selected,
  reducedMotion,
  running,
  labelLayer,
  onHover,
  onSelect,
  onPickMember,
}: ConstellationSceneProps) {
  const camera = useThree((state) => state.camera) as THREE.PerspectiveCamera;
  const size = useThree((state) => state.size);
  const gl = useThree((state) => state.gl);
  const invalidate = useThree((state) => state.invalidate);
  const started = useRef(0);
  const view = useRef({ yaw: 0.6, pitch: PITCH, drag: null as null | { x: number; y: number; yaw: number; pitch: number }, idle: 0 });
  const focus = useRef({ target: new THREE.Vector3(), distance: 0 });
  const blending = light ? THREE.NormalBlending : THREE.AdditiveBlending;

  const texture = useMemo(() => glowTexture(), []);
  useEffect(() => () => texture.dispose(), [texture]);

  const avatars = useMemo(
    () => teams.map((team) => team.members.map((member) => avatarTexture(member.user, team.color, light))),
    [teams, light],
  );
  useEffect(() => () => avatars.flat().forEach((avatar) => avatar.dispose()), [avatars]);

  const maxTeamTokens = Math.max(1, ...teams.map((team) => team.tokens));
  const maxMemberTokens = Math.max(1, ...teams.flatMap((team) => team.members.map((member) => member.tokens)));

  /**
   * Proper 3D alignment for team members:
   * - Arranged in an equidistant satellite arc around the team platform periphery (radius 2.15+).
   * - Faces outward away from the galactic center so members never collide with team cylinders or core beams.
   * - Multi-tier height staggering (0.28 vs 0.44) eliminates occlusion from any camera orbit angle.
   */
  const layout = useMemo(() => {
    return teams.map((team, index) => {
      const angle = (index / teams.length) * Math.PI * 2 - Math.PI / 2;
      const radius = 0.26 + 0.3 * Math.sqrt(team.tokens / maxTeamTokens);
      const N = team.members.length;

      const members: MemberLayout[] = team.members.map((member, pos) => {
        let offsetX = 0;
        let offsetZ = 0;
        let height = 0.32;

        if (N === 1) {
          const R = 2.15;
          offsetX = Math.cos(angle) * R;
          offsetZ = Math.sin(angle) * R;
          height = 0.34;
        } else if (N <= 6) {
          // Single outer arc: R = 2.20
          const R = 2.2;
          const arcSpan = Math.min(Math.PI * 1.15, 0.44 * (N - 1) + 0.4);
          const t = pos / (N - 1) - 0.5; // -0.5 to +0.5
          const subAngle = angle + t * arcSpan;
          offsetX = Math.cos(subAngle) * R;
          offsetZ = Math.sin(subAngle) * R;
          height = 0.3 + (pos % 2) * 0.16;
        } else {
          // Double outer arc for larger teams: Tier 1 (inner, R=2.12) & Tier 2 (outer, R=2.75)
          const tier1Count = Math.min(5, Math.ceil(N / 2));
          if (pos < tier1Count) {
            const R1 = 2.12;
            const arcSpan1 = Math.PI * 0.95;
            const t = tier1Count > 1 ? pos / (tier1Count - 1) - 0.5 : 0;
            const subAngle = angle + t * arcSpan1;
            offsetX = Math.cos(subAngle) * R1;
            offsetZ = Math.sin(subAngle) * R1;
            height = 0.28 + (pos % 2) * 0.12;
          } else {
            const tier2Count = N - tier1Count;
            const tier2Index = pos - tier1Count;
            const R2 = 2.75;
            const arcSpan2 = Math.PI * 1.25;
            const t = tier2Count > 1 ? tier2Index / (tier2Count - 1) - 0.5 : 0;
            const subAngle = angle + t * arcSpan2;
            offsetX = Math.cos(subAngle) * R2;
            offsetZ = Math.sin(subAngle) * R2;
            height = 0.44 + (tier2Index % 2) * 0.15;
          }
        }

        const size = member.tokens > 0 ? 0.32 + 0.25 * Math.sqrt(member.tokens / maxMemberTokens) : 0.28;

        return {
          offsetX,
          offsetZ,
          height,
          size,
          active: member.requests > 0,
        };
      });

      return { angle, radius, members };
    });
  }, [teams, maxTeamTokens, maxMemberTokens]);

  const shapeKey = teams.map((team) => `${team.name}:${team.members.length}`).join("|");
  useEffect(() => {
    started.current = performance.now();
    invalidate();
  }, [shapeKey, invalidate]);

  const stars = useMemo(() => {
    const random = seeded(7);
    const positions = new Float32Array(700 * 3);
    for (let index = 0; index < 700; index += 1) {
      const radius = 30 + random() * 16;
      const theta = random() * Math.PI * 2;
      const phi = Math.acos(2 * random() - 1);
      positions.set([radius * Math.sin(phi) * Math.cos(theta), radius * Math.cos(phi) * 0.7, radius * Math.sin(phi) * Math.sin(theta)], index * 3);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    return geometry;
  }, []);
  useEffect(() => () => stars.dispose(), [stars]);

  const coreRef = useRef<THREE.Group>(null);
  const starsRef = useRef<THREE.Points>(null);
  const teamRefs = useRef<(THREE.Group | null)[]>([]);
  const beamRefs = useRef<(THREE.Line | null)[]>([]);
  const memberRefs = useRef<(THREE.Group | null)[][]>([]);
  const positions = useRef<THREE.Vector3[]>([]);
  const projected = useMemo(() => new THREE.Vector3(), []);
  const scratch = useMemo(() => new THREE.Vector3(), []);

  // Mouse & Pointer Orbit Controls
  useEffect(() => {
    const element = gl.domElement;
    const down = (event: PointerEvent) => {
      view.current.drag = { x: event.clientX, y: event.clientY, yaw: view.current.yaw, pitch: view.current.pitch };
      element.setPointerCapture(event.pointerId);
    };
    const move = (event: PointerEvent) => {
      const drag = view.current.drag;
      if (!drag) return;
      view.current.yaw = drag.yaw - (event.clientX - drag.x) * 0.006;
      view.current.pitch = clamp(drag.pitch + (event.clientY - drag.y) * 0.004, 0.12, 1.15);
      view.current.idle = 0;
      invalidate();
    };
    const up = (event: PointerEvent) => {
      view.current.drag = null;
      if (element.hasPointerCapture(event.pointerId)) element.releasePointerCapture(event.pointerId);
    };

    // Keyboard accessibility for Canvas orbit & zoom
    const key = (event: KeyboardEvent) => {
      let handled = false;
      if (event.key === "ArrowLeft") {
        view.current.yaw -= 0.08;
        handled = true;
      } else if (event.key === "ArrowRight") {
        view.current.yaw += 0.08;
        handled = true;
      } else if (event.key === "ArrowUp") {
        view.current.pitch = clamp(view.current.pitch + 0.06, 0.12, 1.15);
        handled = true;
      } else if (event.key === "ArrowDown") {
        view.current.pitch = clamp(view.current.pitch - 0.06, 0.12, 1.15);
        handled = true;
      } else if (event.key === "+" || event.key === "=") {
        focus.current.distance = Math.max(8, focus.current.distance * 0.92);
        handled = true;
      } else if (event.key === "-" || event.key === "_") {
        focus.current.distance = Math.min(28, focus.current.distance * 1.08);
        handled = true;
      } else if (event.key === "r" || event.key === "R") {
        view.current.yaw = 0.6;
        view.current.pitch = PITCH;
        focus.current.distance = 0;
        handled = true;
      }

      if (handled) {
        event.preventDefault();
        view.current.idle = 0;
        invalidate();
      }
    };

    element.addEventListener("pointerdown", down);
    element.addEventListener("pointermove", move);
    element.addEventListener("pointerup", up);
    element.addEventListener("pointercancel", up);
    element.addEventListener("keydown", key);

    return () => {
      element.removeEventListener("pointerdown", down);
      element.removeEventListener("pointermove", move);
      element.removeEventListener("pointerup", up);
      element.removeEventListener("pointercancel", up);
      element.removeEventListener("keydown", key);
    };
  }, [gl, invalidate]);

  useEffect(() => invalidate(), [size.width, size.height, selected, light, running, reducedMotion, invalidate]);
  const drift = useCappedInvalidate(invalidate);

  useFrame((state, rawDelta) => {
    const delta = Math.min(rawDelta, 1 / 20);
    const elapsed = reducedMotion ? 1e6 : performance.now() - started.current;
    const time = reducedMotion ? 0 : state.clock.elapsedTime;
    const selectedIndex = selected ? teams.findIndex((team) => team.name === selected) : -1;

    if (!reducedMotion && !view.current.drag && running) view.current.yaw += delta * 0.025;

    const core = coreRef.current;
    if (core) {
      const t = easeOut(elapsed / 700);
      core.scale.setScalar(0.6 + 0.4 * t);
      core.rotation.y = time * 0.08;
    }
    if (starsRef.current) starsRef.current.rotation.y = time * 0.01;

    layout.forEach((team, index) => {
      const group = teamRefs.current[index];
      const t = easeOut((elapsed - 220 - index * 120) / 1100);
      const angle = team.angle;
      const position = (positions.current[index] ??= new THREE.Vector3());
      position.set(Math.cos(angle) * ORBIT * t, 0, Math.sin(angle) * ORBIT * t);
      const dim = selectedIndex >= 0 && selectedIndex !== index;

      if (group) {
        group.position.copy(position);
        group.scale.setScalar((0.6 + 0.4 * t) * (selectedIndex === index ? 1.08 : 1));
        const opacity = t * (dim ? 0.28 : 1);
        for (const material of fadeMaterials(group)) material.opacity = (material.userData.base ?? 1) * opacity;
      }

      const beam = beamRefs.current[index];
      if (beam) {
        const attribute = beam.geometry.attributes.position as THREE.BufferAttribute;
        attribute.setXYZ(1, position.x, position.y, position.z);
        attribute.needsUpdate = true;
        (beam.material as THREE.LineBasicMaterial).opacity = (light ? 0.5 : 0.38) * t * (dim ? 0.3 : 1);
      }

      team.members.forEach((memberLayout, position2) => {
        const node = memberRefs.current[index]?.[position2];
        const m = easeOut((elapsed - 600 - index * 100 - position2 * 40) / 750);

        // Position satellites in their dedicated, non-overlapping orbit slots
        scratch.set(
          memberLayout.offsetX * m,
          memberLayout.height * m + Math.sin(time * 0.75 + position2 * 1.2) * 0.025,
          memberLayout.offsetZ * m,
        );

        if (node) {
          node.position.copy(position).add(scratch);
          node.scale.setScalar((0.65 + 0.35 * m) * (dim ? 0.82 : 1));
          const opacity = m * (memberLayout.active ? 1 : 0.45) * (dim ? 0.22 : 1);
          for (const material of fadeMaterials(node)) material.opacity = (material.userData.base ?? 1) * opacity;
        }
      });
    });

    const base = Math.max(14.8, 22.5 / Math.max(0.8, Math.min(1.55, size.width / Math.max(1, size.height))));
    const goalTarget = selectedIndex >= 0 && positions.current[selectedIndex] ? scratch.copy(positions.current[selectedIndex]).multiplyScalar(0.7) : scratch.set(0, 0, 0);
    const goalDistance = selectedIndex >= 0 ? base * 0.58 : base;
    const follow = reducedMotion ? 1 : 1 - Math.exp(-delta * 3.2);

    if (!focus.current.distance) focus.current.distance = goalDistance;
    focus.current.target.lerp(goalTarget, follow);
    focus.current.distance += (goalDistance - focus.current.distance) * follow;

    const { yaw, pitch } = view.current;
    const distance = focus.current.distance;
    const target = focus.current.target;
    camera.position.set(
      target.x + Math.sin(yaw) * Math.cos(pitch) * distance,
      target.y + Math.sin(pitch) * distance,
      target.z + Math.cos(yaw) * Math.cos(pitch) * distance,
    );
    camera.lookAt(target);

    // Project 2D screen positions for DOM labels
    const layer = labelLayer.current;
    if (layer) {
      for (const element of Array.from(layer.children) as HTMLElement[]) {
        const team = element.dataset.team;
        if (team === undefined) {
          projected.set(0, 1.5, 0);
        } else {
          const index = Number(team);
          const position = positions.current[index];
          if (!position) continue;
          projected.copy(position).add(scratch.set(0, 1.35, 0));
        }
        projected.project(camera);
        const x = ((projected.x + 1) / 2) * size.width;
        const y = ((1 - projected.y) / 2) * size.height;
        const hidden = projected.z > 1;
        element.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
        element.style.visibility = hidden ? "hidden" : "visible";
      }
    }

    const settling = Math.abs(goalDistance - focus.current.distance) > 0.01;
    if (!running) return;
    if (view.current.drag || settling || elapsed < 2600) invalidate();
    else if (!reducedMotion) drift();
  });

  const hover = (value: ConstellationHover | null) => (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    gl.domElement.style.cursor = value ? "pointer" : "";
    onHover(value);
  };

  const [c1, c2, c3] = coreColors;

  return (
    <>
      <points ref={starsRef} geometry={stars}>
        <pointsMaterial color={starColor} map={texture} size={0.22} sizeAttenuation transparent opacity={light ? 0.35 : 0.55} depthWrite={false} />
      </points>

      {/* Galactic Core */}
      <group
        ref={coreRef}
        onPointerOver={hover({ kind: "org" })}
        onPointerOut={hover(null)}
        onClick={(event) => {
          event.stopPropagation();
          onSelect(null);
        }}
      >
        {[c1, c2, c3].map((color, index) => (
          <group key={index} position={[0, index * 0.34, 0]} rotation={[0, (index * Math.PI) / 6, 0]}>
            <mesh>
              <cylinderGeometry args={[0.9 - index * 0.15, 0.9 - index * 0.15, 0.2, 6]} />
              <meshBasicMaterial color={color} transparent opacity={light ? 0.7 : 0.5} />
            </mesh>
            <mesh>
              <cylinderGeometry args={[0.91 - index * 0.15, 0.91 - index * 0.15, 0.21, 6]} />
              <meshBasicMaterial color={color} wireframe transparent opacity={0.9} />
            </mesh>
          </group>
        ))}
      </group>

      {/* Teams and their orbiting member satellites */}
      {teams.map((team, index) => (
        <group key={team.name}>
          {/* Radial beam from core to team */}
          <line
            ref={(node) => {
              beamRefs.current[index] = node as unknown as THREE.Line | null;
            }}
          >
            <bufferGeometry>
              <bufferAttribute attach="attributes-position" args={[new Float32Array([0, 0, 0, 0, 0, 0]), 3]} />
            </bufferGeometry>
            <lineBasicMaterial color={team.color} transparent opacity={0} depthWrite={false} />
          </line>

          {/* Team Center Platform */}
          <group
            ref={(node) => {
              teamRefs.current[index] = node;
            }}
            onPointerOver={hover({ kind: "team", team: team.name })}
            onPointerOut={hover(null)}
            onClick={(event) => {
              event.stopPropagation();
              onSelect(selected === team.name ? null : team.name);
            }}
          >
            <mesh position={[0, -0.2, 0]}>
              <cylinderGeometry args={[1.7, 1.7, 0.12, 6]} />
              <meshBasicMaterial color={team.color} transparent opacity={light ? 0.22 : 0.13} userData={{ base: light ? 0.22 : 0.13 }} />
            </mesh>
            <mesh position={[0, -0.2, 0]} raycast={noHit}>
              <cylinderGeometry args={[1.71, 1.71, 0.13, 6]} />
              <meshBasicMaterial color={team.color} wireframe transparent opacity={0.4} userData={{ base: 0.4 }} />
            </mesh>
            <mesh position={[0, 0.12, 0]}>
              <cylinderGeometry args={[layout[index]?.radius ?? 0.4, layout[index]?.radius ?? 0.4, 0.5, 6]} />
              <meshBasicMaterial color={team.color} transparent opacity={0.9} userData={{ base: 0.9 }} />
            </mesh>
            <sprite raycast={noHit} scale={[(layout[index]?.radius ?? 0.4) * 6, (layout[index]?.radius ?? 0.4) * 6, 1]}>
              <spriteMaterial
                map={texture}
                color={team.color}
                transparent
                opacity={light ? 0.4 : 0.85}
                depthWrite={false}
                blending={blending}
                userData={{ base: light ? 0.4 : 0.85 }}
              />
            </sprite>
          </group>

          {/* Members: Satellites positioned outside the platform in orderly orbits */}
          {team.members.map((member, position) => (
            <group key={member.user}>
              <group
                ref={(node) => {
                  (memberRefs.current[index] ??= [])[position] = node;
                }}
                onPointerOver={hover({ kind: "member", team: team.name, user: member.user })}
                onPointerOut={hover(null)}
                onClick={(event) => {
                  event.stopPropagation();
                  onPickMember(team.name, member.user);
                }}
              >
                {/* Glow ring */}
                <sprite scale={[(layout[index]?.members[position]?.size ?? 0.3) * 2.2, (layout[index]?.members[position]?.size ?? 0.3) * 2.2, 1]}>
                  <spriteMaterial
                    map={texture}
                    color={team.color}
                    transparent
                    opacity={light ? 0.2 : 0.35}
                    depthWrite={false}
                    blending={blending}
                    userData={{ base: light ? 0.2 : 0.35 }}
                  />
                </sprite>
                {/* Avatar Initial Disc */}
                <sprite scale={[layout[index]?.members[position]?.size ?? 0.3, layout[index]?.members[position]?.size ?? 0.3, 1]}>
                  <spriteMaterial map={avatars[index]?.[position]} transparent opacity={1} depthWrite={false} />
                </sprite>
              </group>
            </group>
          ))}
        </group>
      ))}
    </>
  );
}

export default function OrgConstellationScene(props: ConstellationSceneProps) {
  return (
    <Canvas
      className="constellation-canvas"
      frameloop="demand"
      dpr={[1, 1.5]}
      gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
      camera={{ fov: 38, near: 0.1, far: 120, position: [0, 6, 12] }}
      onPointerMissed={() => props.onSelect(null)}
      tabIndex={0}
      role="application"
      aria-label="3D constellation view of teams and members. Use arrow keys to orbit, + and - to zoom, and R to reset."
    >
      <Constellation {...props} />
    </Canvas>
  );
}
