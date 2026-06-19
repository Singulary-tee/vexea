export interface GameModeConfig {
  id: string;
  displayName: string;
  description: string;

  matchDuration: number;
  minPlayers: number;
  maxPlayers: number;
  winCondition: 'OBJECTIVE' | 'ELIMINATION' | 'SURVIVAL';
  lossCondition: 'TIMEOUT' | 'TEAM_WIPE';
  winMessage: string;
  lossMessage: string;

  spawnZones: string[];
  respawnEnabled: boolean;
  respawnDelay: number;
  respawnDeathPenaltyScore: number;

  friendlyFireEnabled: boolean;
  friendlyFireDamageMultiplier: number;
  teamKillPenaltyEnabled: boolean;

  bulletDamageEnabled: boolean;
  explosionDamageEnabled: boolean;
  fallDamageEnabled: boolean;
  fallDamageMinHeight: number;
  fallDamageMaxHeight: number;
  fallDamageScaling: 'linear';

  objectiveHoldTime: number;
  objectiveResetOnDamage: boolean;
  objectiveResetOnExit: boolean;
  objectiveProximityRadius: number;
  objectiveTerminalDamageable: boolean;

  availableClasses: ('ASSAULT' | 'MEDIC' | 'RECON' | 'DEMOLITIONS')[];
  classLoadoutsLocked: boolean;

  utilityCooldownMultiplier: number;
  utilityResetsOnRespawn: boolean;

  llmCycleInterval: number;
  llmApStartPool: number;
  llmApRegenPerCycle: number;
  llmDifficultyScaling: boolean;
  llmDifficultyScaleInterval: number;
  llmDifficultyScaleAmount: number;

  droneFriendlyFireExplosions: boolean;
  droneAvoidFriendlyFire: boolean;

  deathCamEnabled: boolean;
  deathCamFallback: 'teammate' | 'fixed';

  scoreTrackingEnabled: boolean;
  scoreIndividual: boolean;
  scoreTeam: boolean;
  scoreValues: {
    droneElimination: number;
    assistElimination: number;
    objectiveProgress: number;
    revivePerformed: number;
    survivalBonus: number;
    deathPenalty: number;
    missionComplete: number;
  };

  postMatchStats: string[];
}

export const GAMEMODES: Record<string, GameModeConfig> = {
  STANDARD: {
    id: 'STANDARD',
    displayName: 'INFILTRATION',
    description: 'Disable the rogue AI before the timer expires. 5–10 contractors. Respawn enabled.',
    matchDuration: 480,
    minPlayers: 1,
    maxPlayers: 10,
    winCondition: 'OBJECTIVE',
    lossCondition: 'TIMEOUT',
    winMessage: 'SYSTEM TERMINATED',
    lossMessage: 'CONTRACT FAILED',
    spawnZones: ['zone_spawn'],
    respawnEnabled: true,
    respawnDelay: 5,
    respawnDeathPenaltyScore: 50,
    friendlyFireEnabled: false,
    friendlyFireDamageMultiplier: 0,
    teamKillPenaltyEnabled: false,
    bulletDamageEnabled: true,
    explosionDamageEnabled: true,
    fallDamageEnabled: true,
    fallDamageMinHeight: 6,
    fallDamageMaxHeight: 20,
    fallDamageScaling: 'linear',
    objectiveHoldTime: 8,
    objectiveResetOnDamage: true,
    objectiveResetOnExit: true,
    objectiveProximityRadius: 3,
    objectiveTerminalDamageable: false,
    availableClasses: ['ASSAULT', 'MEDIC', 'RECON', 'DEMOLITIONS'],
    classLoadoutsLocked: true,
    utilityCooldownMultiplier: 1.0,
    utilityResetsOnRespawn: true,
    llmCycleInterval: 8000,
    llmApStartPool: 20,
    llmApRegenPerCycle: 3,
    llmDifficultyScaling: true,
    llmDifficultyScaleInterval: 120,
    llmDifficultyScaleAmount: 1,
    droneFriendlyFireExplosions: true,
    droneAvoidFriendlyFire: true,
    deathCamEnabled: true,
    deathCamFallback: 'teammate',
    scoreTrackingEnabled: true,
    scoreIndividual: true,
    scoreTeam: true,
    scoreValues: {
      droneElimination: 100,
      assistElimination: 50,
      objectiveProgress: 10,
      revivePerformed: 150,
      survivalBonus: 25,
      deathPenalty: 50,
      missionComplete: 500,
    },
    postMatchStats: [
      'droneEliminations',
      'assists',
      'deaths',
      'objectiveTimeHeld',
      'damageDealt',
      'damageReceived',
      'utilityUsed',
      'distanceTravelled',
      'timeAlive',
      'scoreIndividual',
      'scoreTeam',
      'matchResult',
      'matchDuration',
    ]
  }
};

export const ACTIVE_GAMEMODE = GAMEMODES.STANDARD;
