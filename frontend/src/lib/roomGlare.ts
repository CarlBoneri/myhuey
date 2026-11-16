// The glare check for a room as the app has it: the room in a posture, the lights' real lengths.
import type { BridgeLight, Placement, ProfileTable, Room } from '../types';
import { dimTo, glareScene, traceGlare, type GlareReport, type GlareScene } from './glareMath';
import { effectiveLength, placedProfile } from './lights';
import { posedRoom, type Posture } from './rig';

export interface RoomGlare { posed: Room; scene: GlareScene; report: GlareReport }

export function roomGlare(room: Room, posture: Posture, mode: string, lights: Record<string, BridgeLight>, profiles: ProfileTable | null): RoomGlare {
  const posed = posedRoom(room, posture);
  const scene = glareScene(posed, posture, mode, (placement: Placement) => {
    const profile = placedProfile(placement, lights[placement.light_id], profiles);
    return profile.linear ? effectiveLength(placement, profile) : 0;
  });
  return { posed, scene, report: traceGlare(scene) };
}

/** The real, lit lights that are over their glare limit, with the bridge level (1-254) to bring each down to. */
export function lightsToDim(room: Room, report: GlareReport, lights: Record<string, BridgeLight>): { id: string; label: string; level: number }[] {
  return report.lights
    .filter((light) => !room.lights.find((placed) => placed.light_id === light.light_id)?.planned)
    .map((light) => ({ id: light.light_id, label: lights[light.light_id]?.name ?? light.label, level: dimTo(light.cap, lights[light.light_id]) }))
    .filter((item): item is { id: string; label: string; level: number } => item.level !== null);
}
