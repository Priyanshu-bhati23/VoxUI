"use client";

import { Canvas, useFrame, type ThreeEvent } from "@react-three/fiber";
import { useMemo, useRef, type RefObject } from "react";
import * as THREE from "three";

export type OrbMode = "idle" | "listening" | "thinking" | "building";

/**
 * The voice orb: a sphere whose surface is pushed around by 3D noise in a
 * vertex shader. While listening, the push follows the microphone level, so
 * the orb moves with the speaker's voice.
 *
 * It is also something to play with: the surface swells toward the pointer,
 * dragging spins it with a little inertia, a ring of sparks circles it, and
 * pressing it is the same as pressing the Speak button.
 */

// Simplex noise by Ian McEwan and Stefan Gustavson (MIT licence), the usual GLSL port.
const NOISE = /* glsl */ `
vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
float snoise(vec3 v){
  const vec2 C=vec2(1.0/6.0,1.0/3.0);const vec4 D=vec4(0.0,0.5,1.0,2.0);
  vec3 i=floor(v+dot(v,C.yyy));vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz);vec3 l=1.0-g;vec3 i1=min(g.xyz,l.zxy);vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx;vec3 x2=x0-i2+C.yyy;vec3 x3=x0-D.yyy;
  i=mod289(i);
  vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
  float n_=0.142857142857;vec3 ns=n_*D.wyz-D.xzx;
  vec4 j=p-49.0*floor(p*ns.z*ns.z);vec4 x_=floor(j*ns.z);vec4 y_=floor(j-7.0*x_);
  vec4 x=x_*ns.x+ns.yyyy;vec4 y=y_*ns.x+ns.yyyy;vec4 h=1.0-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy);vec4 b1=vec4(x.zw,y.zw);
  vec4 s0=floor(b0)*2.0+1.0;vec4 s1=floor(b1)*2.0+1.0;vec4 sh=-step(h,vec4(0.0));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy;vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x);vec3 p1=vec3(a0.zw,h.y);vec3 p2=vec3(a1.xy,h.z);vec3 p3=vec3(a1.zw,h.w);
  vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0*=norm.x;p1*=norm.y;p2*=norm.z;p3*=norm.w;
  vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0);m=m*m;
  return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}`;

const VERTEX = /* glsl */ `
${NOISE}
uniform float uTime;
uniform float uAmp;
uniform float uHover;
uniform vec3 uPointer;
varying float vLift;
varying float vTouch;
varying vec3 vNormal;
varying vec3 vView;
void main(){
  float slow = snoise(normal * 1.3 + uTime * 0.35);
  float fine = snoise(normal * 3.4 - uTime * 0.6) * 0.35;
  vLift = slow + fine;
  // The surface swells toward the point under the pointer.
  vTouch = pow(max(dot(normal, uPointer), 0.0), 7.0) * uHover;
  vec3 moved = position + normal * (vLift * uAmp + vTouch * 0.3);
  vec4 world = modelViewMatrix * vec4(moved, 1.0);
  vNormal = normalize(normalMatrix * normal);
  vView = normalize(-world.xyz);
  gl_Position = projectionMatrix * world;
}`;

const FRAGMENT = /* glsl */ `
uniform vec3 uLow;
uniform vec3 uMid;
uniform vec3 uHigh;
varying float vLift;
varying float vTouch;
varying vec3 vNormal;
varying vec3 vView;
void main(){
  float t = smoothstep(-0.9, 0.9, vLift);
  vec3 color = mix(uLow, uMid, smoothstep(0.0, 0.55, t));
  color = mix(color, uHigh, smoothstep(0.55, 1.0, t));
  color = mix(color, uHigh, vTouch * 0.8);
  float rim = pow(1.0 - max(dot(normalize(vNormal), vView), 0.0), 2.4);
  color += rim * 0.35;
  gl_FragColor = vec4(color, 1.0);
}`;

interface OrbProps {
  mode: OrbMode;
  level: RefObject<number>;
  reducedMotion: boolean;
  /** Called when the orb is pressed without being dragged. */
  onPress?: () => void;
}

const SPARKS = 800;

function Blob({ mode, level, reducedMotion, onPress }: OrbProps) {
  const group = useRef<THREE.Group>(null);
  const material = useRef<THREE.ShaderMaterial>(null);
  const sparks = useRef<THREE.Points>(null);
  const amp = useRef(0.12);
  const hover = useRef(0);
  const hovering = useRef(false);
  const spin = useRef({ x: 0, y: 0.15 });
  const drag = useRef<{ x: number; y: number; moved: number } | null>(null);

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uAmp: { value: 0.12 },
      uHover: { value: 0 },
      uPointer: { value: new THREE.Vector3(0, 0, 1) },
      uLow: { value: new THREE.Color("#D81E78") },
      uMid: { value: new THREE.Color("#FF6A45") },
      uHigh: { value: new THREE.Color("#FFD76A") },
    }),
    [],
  );

  const sparkGeometry = useMemo(() => {
    const positions = new Float32Array(SPARKS * 3);
    for (let i = 0; i < SPARKS; i++) {
      // A loose, tilted band around the orb.
      const angle = Math.random() * Math.PI * 2;
      const radius = 1.7 + Math.random() * 0.4;
      positions[i * 3] = Math.cos(angle) * radius;
      positions[i * 3 + 1] = (Math.random() - 0.5) * 0.28;
      positions[i * 3 + 2] = Math.sin(angle) * radius;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    return geometry;
  }, []);

  useFrame((_, dt) => {
    const step = Math.min(dt, 0.05);
    // Write to the material's own uniforms. The renderer keeps its own copy of
    // each one, so changing the object passed in as a prop would not reach the shader.
    const u = material.current?.uniforms;
    if (!u || !group.current) return;

    const speed = reducedMotion ? 0 : mode === "idle" ? 0.5 : mode === "listening" ? 1.1 : 2.2;
    u.uTime.value += step * speed;
    const voice = Math.min(1, level.current * 3.2);
    const target =
      mode === "listening"
        ? 0.14 + voice * 0.5
        : mode === "thinking"
          ? 0.22
          : mode === "building"
            ? 0.2 + (reducedMotion ? 0 : 0.08 * Math.sin(u.uTime.value * 3))
            : 0.11;
    amp.current += (target - amp.current) * (1 - Math.exp(-step * 9));
    u.uAmp.value = amp.current;

    hover.current += ((hovering.current ? 1 : 0) - hover.current) * (1 - Math.exp(-step * 8));
    u.uHover.value = hover.current;

    // Spin: a slow idle turn, plus whatever the last drag left behind.
    if (!reducedMotion) {
      if (!drag.current) {
        spin.current.x *= Math.exp(-step * 2.5);
        spin.current.y += (0.15 - spin.current.y) * (1 - Math.exp(-step * 1.5));
      }
      group.current.rotation.y += spin.current.y * step;
      group.current.rotation.x = THREE.MathUtils.clamp(group.current.rotation.x + spin.current.x * step, -0.9, 0.9);
    }

    if (sparks.current) {
      const busy = mode === "building" || mode === "thinking";
      if (!reducedMotion) sparks.current.rotation.y -= step * (busy ? 1.6 : 0.35);
      const reach = 1 + (mode === "listening" ? voice * 0.45 : 0) + hover.current * 0.06;
      sparks.current.scale.setScalar(sparks.current.scale.x + (reach - sparks.current.scale.x) * (1 - Math.exp(-step * 10)));
    }
  });

  const pointAt = (e: ThreeEvent<PointerEvent>) => {
    if (!group.current || !material.current) return;
    hovering.current = true;
    material.current.uniforms.uPointer.value.copy(group.current.worldToLocal(e.point.clone())).normalize();
  };

  return (
    <group
      ref={group}
      onPointerDown={(e) => {
        (e.target as Element).setPointerCapture?.(e.pointerId);
        drag.current = { x: e.clientX, y: e.clientY, moved: 0 };
      }}
      onPointerMove={(e) => {
        pointAt(e);
        if (!drag.current) return;
        const dx = e.clientX - drag.current.x;
        const dy = e.clientY - drag.current.y;
        drag.current = { x: e.clientX, y: e.clientY, moved: drag.current.moved + Math.abs(dx) + Math.abs(dy) };
        spin.current.y = dx * 0.45;
        spin.current.x = dy * 0.45;
      }}
      onPointerUp={(e) => {
        (e.target as Element).releasePointerCapture?.(e.pointerId);
        const wasPress = drag.current !== null && drag.current.moved < 6;
        drag.current = null;
        if (wasPress) onPress?.();
      }}
      onPointerOut={() => {
        hovering.current = false;
      }}
    >
      <mesh>
        <icosahedronGeometry args={[1.25, 48]} />
        <shaderMaterial ref={material} vertexShader={VERTEX} fragmentShader={FRAGMENT} uniforms={uniforms} />
      </mesh>
      <points ref={sparks} geometry={sparkGeometry} rotation={[0.45, 0, 0.25]}>
        <pointsMaterial color="#FFD76A" size={0.05} sizeAttenuation transparent opacity={0.95} depthWrite={false} />
      </points>
    </group>
  );
}

export default function Orb(props: OrbProps) {
  return (
    <Canvas dpr={[1, 2]} camera={{ position: [0, 0, 5.2], fov: 45 }} gl={{ antialias: true, alpha: true }}>
      <Blob {...props} />
    </Canvas>
  );
}
