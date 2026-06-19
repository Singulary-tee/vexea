export class ZoneRegistry {
  private restrictedGates: any[] = [];

  public loadFromSpec(specJson: any) {
    if (specJson && Array.isArray(specJson.restrictedGates)) {
      this.restrictedGates = specJson.restrictedGates;
    }
  }

  public isInRestrictedGate(x: number, z: number): boolean {
    for (let i = 0; i < this.restrictedGates.length; i++) {
      const gate = this.restrictedGates[i];
      if (gate && gate.position) {
        const radius = typeof gate.killZoneRadius === 'number' ? gate.killZoneRadius : 15;
        const dx = x - gate.position.x;
        const dz = z - gate.position.z;
        const distSq = dx * dx + dz * dz;
        if (distSq <= radius * radius) {
          return true;
        }
      }
    }
    return false;
  }
}
