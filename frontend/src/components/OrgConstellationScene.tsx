"use client";

import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo, useRef, type RefObject } from "react";
import * as THREE from "three";

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
  context.beginPath();
  context.arc(center, center, center - 8, 0, Math.PI * 2);
  context.fillStyle = light ? "#ffffff" : "#0b0e1a";
  context.fill();
  context.lineWidth = 9;
  context.strokeStyle = color;
  context.stroke();
  context.beginPath();
  context.arc(center, center, center - 19, 0, Math.PI * 2);
  context.lineWidth = 2;
  context.globalAlpha = 0.35;
  context.stroke();
  context.globalAlpha = 1;
  const letter = name.match(/[\p{L}\p{N}]/u)?.[0]?.toUpperCase() ?? "?";
  context.fillStyle = light ? "#11132a" : color;
  context.font = `700 58px "Instrument Sans", "Bricolage Grotesque", system-ui, sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(letter, center, center + 3);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function circlePoints(radius: number, segments = 128) {
  const points: THREE.Vector3[] = [];
  for (let index = 0; index <= segments; index += 1) {
    const angle = (index / segments) * Math.PI * 2;
    points.push(new THREE.Vector3(Math.cos(angle) * radius, 0, Math.sin(angle) * radius));
  }
  return points;
}

type MemberLayout = { radius: number; phase: number; speed: number; tilt: THREE.Euler; size: number; active: boolean };

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

  const layout = useMemo(() => {
    const random = seeded(20261031);
    return teams.map((team, index) => {
      const angle = (index / teams.length) * Math.PI * 2 - Math.PI / 2;
      const radius = 0.26 + 0.3 * Math.sqrt(team.tokens / maxTeamTokens);
      const members: MemberLayout[] = team.members.map((member, position) => ({
        radius: radius + 0.62 + (position % 3) * 0.3 + random() * 0.08,
        phase: (position / Math.max(1, team.members.length)) * Math.PI * 2 + random() * 0.4,
        speed: (0.22 + random() * 0.28) * (position % 2 ? -1 : 1),
        tilt: new THREE.Euler((random() - 0.5) * 1.1, 0, (random() - 0.5) * 1.1),
        size: member.tokens > 0 ? 0.36 + 0.42 * Math.sqrt(member.tokens / maxMemberTokens) : 0.3,
        active: member.requests > 0,
      }));
      return { angle, radius, members, home: new THREE.Vector3(Math.cos(angle) * ORBIT, 0, Math.sin(angle) * ORBIT) };
    });
  }, [teams, maxTeamTokens, maxMemberTokens]);

  // Restart the entrance when the shape of the organization changes.
  const shapeKey = teams.map((team) => `${team.name}:${team.members.length}`).join("|");
  useEffect(() => {
    started.current = performance.now();
    invalidate();
  }, [shapeKey, invalidate]);

  const stars = useMemo(() => {
    const random = seeded(7);
    const positions = new Float32Array(700 * 3);
    for (let index = 0; index < 700; index += 1) {
      const radius = 12 + random() * 14;
      const theta = random() * Math.PI * 2;
      const phi = Math.acos(2 * random() - 1);
      positions.set([radius * Math.sin(phi) * Math.cos(theta), radius * Math.cos(phi) * 0.7, radius * Math.sin(phi) * Math.sin(theta)], index * 3);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    return geometry;
  }, []);
  useEffect(() => () => stars.dispose(), [stars]);

  const orbitGeometry = useMemo(() => new THREE.BufferGeometry().setFromPoints(circlePoints(ORBIT, 180)), []);
  const unitRing = useMemo(() => new THREE.BufferGeometry().setFromPoints(circlePoints(1, 96)), []);
  useEffect(() => () => {
    orbitGeometry.dispose();
    unitRing.dispose();
  }, [orbitGeometry, unitRing]);

  const coreRef = useRef<THREE.Group>(null);
  const starsRef = useRef<THREE.Points>(null);
  const teamRefs = useRef<(THREE.Group | null)[]>([]);
  const beamRefs = useRef<(THREE.Line | null)[]>([]);
  const memberRefs = useRef<(THREE.Group | null)[][]>([]);
  const ringRefs = useRef<(THREE.Line | null)[][]>([]);
  const positions = useRef<THREE.Vector3[]>([]);
  const projected = useMemo(() => new THREE.Vector3(), []);
  const scratch = useMemo(() => new THREE.Vector3(), []);

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
    element.addEventListener("pointerdown", down);
    element.addEventListener("pointermove", move);
    element.addEventListener("pointerup", up);
    element.addEventListener("pointercancel", up);
    return () => {
      element.removeEventListener("pointerdown", down);
      element.removeEventListener("pointermove", move);
      element.removeEventListener("pointerup", up);
      element.removeEventListener("pointercancel", up);
    };
  }, [gl, invalidate]);

  useEffect(() => invalidate(), [size.width, size.height, selected, light, invalidate]);

  useFrame((state, rawDelta) => {
    const delta = Math.min(rawDelta, 1 / 20);
    const elapsed = reducedMotion ? 1e6 : performance.now() - started.current;
    const time = reducedMotion ? 0 : state.clock.elapsedTime;
    const selectedIndex = selected ? teams.findIndex((team) => team.name === selected) : -1;

    if (!reducedMotion && !view.current.drag && running) view.current.yaw += delta * 0.06;

    const core = coreRef.current;
    if (core) {
      const t = easeOut(elapsed / 700);
      core.scale.setScalar(0.6 + 0.4 * t);
      core.rotation.y = time * 0.35;
      core.rotation.x = Math.sin(time * 0.4) * 0.2;
    }
    if (starsRef.current) starsRef.current.rotation.y = time * 0.01;

    layout.forEach((team, index) => {
      const group = teamRefs.current[index];
      const t = easeOut((elapsed - 220 - index * 120) / 1100);
      const angle = team.angle + (reducedMotion ? 0 : Math.sin(time * 0.15 + index) * 0.02);
      const position = (positions.current[index] ??= new THREE.Vector3());
      position.set(Math.cos(angle) * ORBIT * t, Math.sin(time * 0.6 + index) * 0.08, Math.sin(angle) * ORBIT * t);
      const dim = selectedIndex >= 0 && selectedIndex !== index;
      if (group) {
        group.position.copy(position);
        const pulse = 1 + (reducedMotion ? 0 : Math.sin(time * 1.6 + index) * 0.04);
        group.scale.setScalar((0.6 + 0.4 * t) * pulse * (selectedIndex === index ? 1.18 : 1));
        group.traverse((child) => {
          const material = (child as THREE.Mesh).material as THREE.Material & { opacity: number; userData: { base?: number } };
          if (material && "opacity" in material) {
            const base = material.userData.base ?? 1;
            material.opacity = base * t * (dim ? 0.28 : 1);
          }
        });
      }
      const beam = beamRefs.current[index];
      if (beam) {
        const attribute = beam.geometry.attributes.position as THREE.BufferAttribute;
        attribute.setXYZ(1, position.x, position.y, position.z);
        attribute.needsUpdate = true;
        (beam.material as THREE.LineBasicMaterial).opacity = (light ? 0.5 : 0.38) * t * (dim ? 0.3 : 1);
      }
      team.members.forEach((member, position2) => {
        const node = memberRefs.current[index]?.[position2];
        const ring = ringRefs.current[index]?.[position2];
        const m = easeOut((elapsed - 760 - index * 120 - position2 * 45) / 800);
        const angle2 = member.phase + time * member.speed;
        scratch.set(Math.cos(angle2) * member.radius * m, 0, Math.sin(angle2) * member.radius * m).applyEuler(member.tilt);
        if (node) {
          node.position.copy(position).add(scratch);
          node.scale.setScalar(0.6 + 0.4 * m);
          node.traverse((child) => {
            const material = (child as THREE.Mesh).material as THREE.Material & { opacity: number; userData: { base?: number } };
            if (material && "opacity" in material) {
              const base = material.userData.base ?? 1;
              material.opacity = base * m * (member.active ? 1 : 0.4) * (dim ? 0.25 : 1);
            }
          });
        }
        if (ring) {
          ring.position.copy(position);
          ring.rotation.copy(member.tilt);
          ring.scale.setScalar(member.radius * m);
          (ring.material as THREE.LineBasicMaterial).opacity = (light ? 0.22 : 0.12) * m * (dim ? 0.3 : 1);
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

    const layer = labelLayer.current;
    if (layer) {
      for (const element of Array.from(layer.children) as HTMLElement[]) {
        const team = element.dataset.team;
        if (team === undefined) {
          projected.set(0, 1.05, 0);
        } else {
          const index = Number(team);
          const position = positions.current[index];
          if (!position) continue;
          projected.copy(position).add(scratch.set(0, layout[index].radius + 0.32, 0));
        }
        projected.project(camera);
        const x = ((projected.x + 1) / 2) * size.width;
        const y = ((1 - projected.y) / 2) * size.height;
        const hidden = projected.z > 1;
        element.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
        element.style.visibility = hidden ? "hidden" : "visible";
      }
    }

    if (running && !reducedMotion) invalidate();
    else if (elapsed < 2600 || Math.abs(goalDistance - focus.current.distance) > 0.01) invalidate();
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
        <pointsMaterial color={starColor} size={0.06} sizeAttenuation transparent opacity={light ? 0.35 : 0.55} depthWrite={false} />
      </points>
      <lineLoop geometry={orbitGeometry}>
        <lineBasicMaterial color={c2} transparent opacity={light ? 0.35 : 0.22} depthWrite={false} />
      </lineLoop>
      <group ref={coreRef} onPointerOver={hover({ kind: "org" })} onPointerOut={hover(null)} onClick={(event) => { event.stopPropagation(); onSelect(null); }}>
        <mesh>
          <icosahedronGeometry args={[0.78, 1]} />
          <meshBasicMaterial color={c2} wireframe transparent opacity={0.75} />
        </mesh>
        <mesh>
          <icosahedronGeometry args={[0.46, 0]} />
          <meshBasicMaterial color={c1} transparent opacity={0.95} />
        </mesh>
        <mesh rotation={[Math.PI / 2.4, 0, 0]}>
          <torusGeometry args={[1.08, 0.012, 8, 96]} />
          <meshBasicMaterial color={c3} transparent opacity={0.7} />
        </mesh>
        <sprite scale={[4.2, 4.2, 1]}>
          <spriteMaterial map={texture} color={c2} transparent opacity={light ? 0.35 : 0.8} depthWrite={false} blending={blending} />
        </sprite>
      </group>
      {teams.map((team, index) => (
        <group key={team.name}>
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
            <mesh>
              <sphereGeometry args={[layout[index]?.radius ?? 0.4, 40, 40]} />
              <meshBasicMaterial color={team.color} transparent opacity={1} />
            </mesh>
            <mesh>
              <sphereGeometry args={[(layout[index]?.radius ?? 0.4) * 1.32, 24, 24]} />
              <meshBasicMaterial color={team.color} wireframe transparent opacity={0.22} userData={{ base: 0.22 }} />
            </mesh>
            <sprite scale={[(layout[index]?.radius ?? 0.4) * 6, (layout[index]?.radius ?? 0.4) * 6, 1]}>
              <spriteMaterial map={texture} color={team.color} transparent opacity={light ? 0.4 : 0.85} depthWrite={false} blending={blending} userData={{ base: light ? 0.4 : 0.85 }} />
            </sprite>
          </group>
          {team.members.map((member, position) => (
            <group key={member.user}>
              <lineLoop
                ref={(node) => {
                  (ringRefs.current[index] ??= [])[position] = node as unknown as THREE.Line | null;
                }}
                geometry={unitRing}
              >
                <lineBasicMaterial color={team.color} transparent opacity={0} depthWrite={false} />
              </lineLoop>
              <group
                ref={(node) => {
                  (memberRefs.current[index] ??= [])[position] = node;
                }}
                onPointerOver={hover({ kind: "member", team: team.name, user: member.user })}
                onPointerOut={hover(null)}
                onClick={(event) => {
                  event.stopPropagation();
                  onSelect(team.name);
                }}
              >
                <sprite scale={[(layout[index]?.members[position]?.size ?? 0.3) * 2.2, (layout[index]?.members[position]?.size ?? 0.3) * 2.2, 1]}>
                  <spriteMaterial map={texture} color={team.color} transparent opacity={light ? 0.18 : 0.3} depthWrite={false} blending={blending} userData={{ base: light ? 0.18 : 0.3 }} />
                </sprite>
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
      dpr={[1, 2]}
      gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
      camera={{ fov: 38, near: 0.1, far: 120, position: [0, 6, 12] }}
      onPointerMissed={() => props.onSelect(null)}
    >
      <Constellation {...props} />
    </Canvas>
  );
}
