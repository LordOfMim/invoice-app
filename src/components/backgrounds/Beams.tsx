"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import type { Mesh } from "three";

type BeamProps = {
  beamNumber?: number;
  beamWidth?: number;
  beamHeight?: number;
  speed?: number;
  lightColor?: string;
  rotation?: number;
  onRenderError?: () => void;
};

function BeamField({
  beamNumber = 10,
  beamWidth = 0.16,
  beamHeight = 5.5,
  speed = 0.25,
  lightColor = "#3b82f6",
  rotation = -18,
}: Required<Omit<BeamProps, "onRenderError">>) {
  const groupRef = useRef<Mesh[]>([]);
  const beams = useMemo(
    () =>
      Array.from({ length: beamNumber }, (_, index) => ({
        x: (index / Math.max(1, beamNumber - 1)) * 8 - 4,
        y: -0.2 + (index % 3) * 0.22,
        delay: index * 0.19,
        opacity: 0.08 + (index % 4) * 0.018,
      })),
    [beamNumber]
  );

  useFrame(({ clock }) => {
    const time = clock.elapsedTime * speed;
    for (let i = 0; i < groupRef.current.length; i++) {
      const mesh = groupRef.current[i];
      if (!mesh) continue;
      const beam = beams[i];
      mesh.position.y = beam.y + Math.sin(time + beam.delay) * 0.18;
      mesh.position.x = beam.x + Math.sin(time * 0.6 + beam.delay) * 0.08;
    }
  });

  return (
    <group rotation={[0, 0, (rotation * Math.PI) / 180]}>
      {beams.map((beam, index) => (
        <mesh
          key={index}
          ref={(node) => {
            if (node) groupRef.current[index] = node;
          }}
          position={[beam.x, beam.y, -1]}
        >
          <planeGeometry args={[beamWidth, beamHeight]} />
          <meshBasicMaterial color={lightColor} transparent opacity={beam.opacity} depthWrite={false} />
        </mesh>
      ))}
    </group>
  );
}

export default function Beams({
  beamNumber = 12,
  beamWidth = 0.18,
  beamHeight = 5.6,
  speed = 0.28,
  lightColor = "#3b82f6",
  rotation = -18,
  onRenderError,
}: BeamProps) {
  return (
    <Canvas
      frameloop="always"
      dpr={[1, 1.15]}
      camera={{ position: [0, 0, 5], fov: 52 }}
      gl={{ alpha: true, antialias: false, powerPreference: "low-power" }}
      onCreated={({ gl }) => {
        gl.setClearColor(0x000000, 0);
      }}
      onError={onRenderError}
      className="h-full w-full"
    >
      <BeamField
        beamNumber={beamNumber}
        beamWidth={beamWidth}
        beamHeight={beamHeight}
        speed={speed}
        lightColor={lightColor}
        rotation={rotation}
      />
    </Canvas>
  );
}
