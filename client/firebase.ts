/**
 * VEXEA Client Firebase Integration Manager
 * Implements lazy initialization and robust failure bypass, conforming to the Firestore-Integration skill.
 */

import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  getFirestore,
  Firestore
} from "firebase/firestore";
import { getAuth, signInAnonymously, Auth } from "firebase/auth";
import { getStorage, FirebaseStorage } from "firebase/storage";

export enum OperationType {
  CREATE = "create",
  UPDATE = "update",
  DELETE = "delete",
  LIST = "list",
  GET = "get",
  WRITE = "write",
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export let db: Firestore | null = null;
export let auth: Auth | null = null;
export let storage: FirebaseStorage | null = null;
export let isFirebaseReady = false;

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const currentUserId = auth?.currentUser?.uid;
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: currentUserId || null,
      email: auth?.currentUser?.email || null,
      emailVerified: auth?.currentUser?.emailVerified || null,
      isAnonymous: auth?.currentUser?.isAnonymous || null,
      tenantId: auth?.currentUser?.tenantId || null,
      providerInfo: auth?.currentUser?.providerData?.map(provider => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || []
    },
    operationType,
    path
  };
  console.error("Firestore Error: ", JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

import firebaseConfig from "../firebase-applet-config.json";

export async function initFirebase(): Promise<boolean> {
  try {
    const { initializeApp } = await import("firebase/app");
    const app = initializeApp(firebaseConfig);
    db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
    auth = getAuth(app);
    storage = getStorage(app);
    isFirebaseReady = true;
    console.log("Firebase initialized successfully with configuration credentials.");
    return true;
  } catch (err) {
    console.warn("VEXEA Database Notice: Missing firebase-applet-config.json. Running in local sandbox.");
    isFirebaseReady = false;
    return false;
  }
}

export async function authenticateAnonymously(): Promise<string | null> {
  if (!isFirebaseReady || !auth) return null;
  try {
    const userCredential = await signInAnonymously(auth);
    return userCredential.user.uid;
  } catch (error) {
    console.error("Firebase Anonymous Auth failed:", error);
    return null;
  }
}

export interface PlayerCloudStats {
  playedCount: number;
  highScore: number;
  xp: number;
  updatedAt: string;
}

export async function fetchPlayerStats(playerId: string): Promise<PlayerCloudStats | null> {
  if (!isFirebaseReady || !db) return null;
  const pathStr = `player_stats/${playerId}`;
  try {
    const docRef = doc(db, "player_stats", playerId);
    const snap = await getDoc(docRef);
    if (snap.exists()) {
      return snap.data() as PlayerCloudStats;
    } else {
      // Create initial stats document
      const initialStats: PlayerCloudStats = {
        playedCount: 0,
        highScore: 0,
        xp: 0,
        updatedAt: new Date().toISOString()
      };
      await setDoc(docRef, initialStats);
      return initialStats;
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, pathStr);
    return null;
  }
}

export async function savePlayerStats(playerId: string, matchesPlayed: number, high: number, points: number): Promise<boolean> {
  if (!isFirebaseReady || !db) return false;
  const pathStr = `player_stats/${playerId}`;
  try {
    const docRef = doc(db, "player_stats", playerId);
    const updated: PlayerCloudStats = {
      playedCount: matchesPlayed,
      highScore: high,
      xp: points,
      updatedAt: new Date().toISOString()
    };
    await setDoc(docRef, updated);
    return true;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, pathStr);
    return false;
  }
}

export async function lockMatchSession(matchId: string, playerId: string): Promise<boolean> {
  if (!isFirebaseReady || !db) return false;
  const pathStr = `matches_in_progress/${matchId}`;
  try {
    const docRef = doc(db, "matches_in_progress", matchId);
    await setDoc(docRef, {
      playerId,
      createdAt: new Date().toISOString()
    });
    return true;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, pathStr);
    return false;
  }
}

export async function unlockMatchSession(matchId: string): Promise<boolean> {
  if (!isFirebaseReady || !db) return false;
  const pathStr = `matches_in_progress/${matchId}`;
  try {
    const { deleteDoc } = await import("firebase/firestore");
    const docRef = doc(db, "matches_in_progress", matchId);
    await deleteDoc(docRef);
    return true;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, pathStr);
    return false;
  }
}

export async function testStorageUpload(): Promise<boolean> {
  if (!isFirebaseReady || !storage) return false;
  try {
    const { ref, uploadBytes, getDownloadURL } = await import("firebase/storage");
    const testRef = ref(storage, 'test_upload.txt');
    const blob = new Blob(['Firebase Storage is working!'], { type: 'text/plain' });
    await uploadBytes(testRef, blob);
    const url = await getDownloadURL(testRef);
    console.log("Firebase Storage test upload successful. URL:", url);
    return true;
  } catch (error) {
    console.error("Firebase Storage test upload failed:", error);
    return false;
  }
}
