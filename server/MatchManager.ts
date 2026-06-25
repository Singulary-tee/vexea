import { MatchRoom } from "./MatchRoom";
import { ChannelAdapter } from "./transport/adapter";

class MatchManager {
  private activeRooms: Map<string, MatchRoom> = new Map();

  /**
   * Returns an existing MatchRoom or creates a new one for a designated matchId.
   */
  public getOrCreateRoom(roomId: string, geminiKey?: string, mapId?: string): MatchRoom {
    let room = this.activeRooms.get(roomId);
    if (!room) {
      console.log(`[MATCH MANAGER] Creating new MatchRoom: ${roomId} (Requested Map: ${mapId || 'none'})`);
      room = new MatchRoom(roomId, geminiKey, mapId);
      this.activeRooms.set(roomId, room);
    }
    return room;
  }

  /**
   * Finds an available MatchRoom with fewer than 10 players that hasn't started yet,
   * or creates a new automated one. (Matchmaking)
   */
  public findMatchmakingRoom(geminiKey?: string): MatchRoom {
    for (const room of this.activeRooms.values()) {
      if (!room.matchActive && room.players.size < 10) {
        console.log(`[MATCH MANAGER] Matchmaking found open room: ${room.roomId} (${room.players.size}/10)`);
        return room;
      }
    }

    const newId = `M_AUTO_${Math.floor(Math.random() * 100000)}`;
    console.log(`[MATCH MANAGER] No open rooms. Provisioning matchmaking room: ${newId}`);
    return this.getOrCreateRoom(newId, geminiKey);
  }

  /**
   * Removes a MatchRoom and clears its simulation routines once empty.
   */
  public deleteRoom(roomId: string) {
    const room = this.activeRooms.get(roomId);
    if (room) {
      console.log(`[MATCH MANAGER] Shutting down empty Room: ${roomId}`);
      this.activeRooms.delete(roomId);
      room.shutdown();
    }
  }

  /**
   * Returns a list of active rooms.
   */
  public getRooms(): MatchRoom[] {
    return Array.from(this.activeRooms.values());
  }

  public getRoomCount(): number {
    return this.activeRooms.size;
  }
}

export const matchManager = new MatchManager();
export default matchManager;
