import * as THREE from "three/webgpu";
import { MatchController } from "../../MatchController";
import { GlobalState } from "../../state";
import { ZONE_BOUNDS, WAYPOINTS, DRONE_CONFIGS, DroneType } from "../../../shared/constants";

export class DiagnosisSystem {
    private match: MatchController;
    private bulletLines: THREE.LineSegments | null = null;
    private hitSpheres: THREE.Group | null = null;
    private aiSightGroup: THREE.Group | null = null;
    private zoneBorders: THREE.Group | null = null;
    private navPointsGroup: THREE.Group | null = null;
    private droneCollidersGroup: THREE.Group | null = null;
    private droneColliderMeshes: Map<string, THREE.Mesh> = new Map();
    private droneSphereGeom = new THREE.SphereGeometry(1, 12, 12);
    private droneBoxGeom = new THREE.BoxGeometry(2, 2, 2);
    private droneCapsuleGeom = new THREE.CapsuleGeometry(1, 2, 4, 8); // radius 1, length 2 (total 4)
    private droneWireMat = new THREE.MeshBasicMaterial({ color: 0xff00ff, wireframe: true });
    private activeDronesThisTick = new Set<string>();
    private interpLinesGroup: THREE.Group | null = null;
    private interpLines: Map<number, THREE.Line> = new Map();
    
    // HTML overlays for AI Sight Text
    private aiTextContainer: HTMLDivElement | null = null;

    constructor(match: MatchController) {
        this.match = match;
    }

    public init() {
        // Init containers
        this.bulletLines = new THREE.LineSegments(
            new THREE.BufferGeometry(),
            new THREE.LineBasicMaterial({ vertexColors: true, linewidth: 2, depthTest: false })
        );
        this.bulletLines.renderOrder = 999;
        this.match.scene.add(this.bulletLines);

        this.hitSpheres = new THREE.Group();
        this.match.scene.add(this.hitSpheres);
        
        this.aiSightGroup = new THREE.Group();
        this.match.scene.add(this.aiSightGroup);
        
        this.zoneBorders = new THREE.Group();
        this.navPointsGroup = new THREE.Group();
        this.match.scene.add(this.navPointsGroup);
        
        // Build Nav Points
        for (const wp of Object.values(WAYPOINTS)) {
            const sphere = new THREE.Mesh(
                new THREE.SphereGeometry(1.5, 8, 8),
                new THREE.MeshBasicMaterial({ color: 0x00aaff, wireframe: true, depthTest: false })
            );
            sphere.position.set(wp.x, wp.y, wp.z);
            this.navPointsGroup.add(sphere);
        }
        this.droneCollidersGroup = new THREE.Group();
        this.interpLinesGroup = new THREE.Group();
        this.match.scene.add(this.interpLinesGroup);
        this.match.scene.add(this.droneCollidersGroup);
        this.match.scene.add(this.zoneBorders);
        
        // Build Zone Borders
        for (const [zoneName, bound] of Object.entries(ZONE_BOUNDS)) {
            const box = new THREE.Box3(
                new THREE.Vector3(bound.center.x - bound.halfSize.x, 0, bound.center.z - bound.halfSize.z),
                new THREE.Vector3(bound.center.x + bound.halfSize.x, 40, bound.center.z + bound.halfSize.z)
            );
            const helper = new THREE.Box3Helper(box, new THREE.Color(0xff00ff));
            this.zoneBorders.add(helper);
        }
        
        // Init HTML overlay container
        this.aiTextContainer = document.createElement("div");
        this.aiTextContainer.style.position = "absolute";
        this.aiTextContainer.style.top = "0";
        this.aiTextContainer.style.left = "0";
        this.aiTextContainer.style.width = "100%";
        this.aiTextContainer.style.height = "100%";
        this.aiTextContainer.style.pointerEvents = "none";
        this.aiTextContainer.style.zIndex = "100";
        document.body.appendChild(this.aiTextContainer);
    }

    public update() {
        const vis = (GlobalState as any).visDiag;
        if (!vis) return;
        
        // Zone Borders
        if (this.interpLinesGroup) {
            this.interpLinesGroup.visible = vis.interpPaths;
        }
        if (this.droneCollidersGroup) {
            this.droneCollidersGroup.visible = vis.colliders;
        }
        if (this.navPointsGroup) {
            this.navPointsGroup.visible = vis.navPoints;
        }
        if (this.zoneBorders) {
            this.zoneBorders.visible = vis.zoneBorders;
        }

        // Bullet Paths
        if (this.bulletLines) {
            this.bulletLines.visible = vis.bulletPaths;
            if (vis.bulletPaths) {
                const positions: number[] = [];
                const colors: number[] = [];
                
                for (const path of this.match.serverBulletPaths) {
                    positions.push(path.origin.x, path.origin.y, path.origin.z);
                    positions.push(path.impact.x, path.impact.y, path.impact.z);
                    
                    const col = path.type === "HIT_CONFIRMED" ? new THREE.Color(1, 0, 0) : new THREE.Color(0,  greenColorVal(), 0);
                    function greenColorVal() { return 1; } // Green helper
                    colors.push(col.r, col.g, 0);
                    colors.push(col.r, col.g, 0);
                }
                
                const newGeom = new THREE.BufferGeometry();
                if (positions.length > 0) {
                    newGeom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
                    newGeom.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
                }
                this.bulletLines.geometry.dispose();
                this.bulletLines.geometry = newGeom;
            }
        }
        
        // Hit Spheres
        if (this.hitSpheres) {
            this.hitSpheres.visible = vis.hitSpheres;
            if (vis.hitSpheres) {
                // simple pool
                while(this.hitSpheres.children.length < this.match.serverBulletPaths.length) {
                    const mesh = new THREE.Mesh(
                        new THREE.SphereGeometry(0.5, 8, 8),
                        new THREE.MeshBasicMaterial({ color: 0xff0000, depthTest: false })
                    );
                    mesh.renderOrder = 1000;
                    this.hitSpheres.add(mesh);
                }
                for (let i = 0; i < this.hitSpheres.children.length; i++) {
                    const child = this.hitSpheres.children[i] as THREE.Mesh;
                    if (i < this.match.serverBulletPaths.length) {
                        child.visible = true;
                        const path = this.match.serverBulletPaths[i];
                        child.position.copy(path.impact);
                        (child.material as THREE.MeshBasicMaterial).color.setHex(path.type === "HIT_CONFIRMED" ? 0xff0000 : 0x00ff00);
                    } else {
                        child.visible = false;
                    }
                }
            }
        }
        
        // Nav Points
        if (this.navPointsGroup) {
            this.navPointsGroup.visible = vis.navPoints;
        }

        // Interpolation Paths
        if (this.interpLinesGroup) {
            this.interpLinesGroup.visible = vis.interpPaths;
            if (vis.interpPaths) {
                for (const [id, buffer] of this.match.droneJitterMap.entries()) {
                    if (buffer.count > 1) {
                        const head = buffer.states[(buffer.head - 1 + 3) % 3];
                        if (head.state === 5) {
                            if (this.interpLines.has(id)) this.interpLines.get(id)!.visible = false;
                            continue;
                        }
                        
                        let line = this.interpLines.get(id);
                        if (!line) {
                            line = new THREE.Line(
                                new THREE.BufferGeometry(),
                                new THREE.LineBasicMaterial({ color: 0x00ffff, depthTest: false })
                            );
                            line.renderOrder = 998;
                            this.interpLines.set(id, line);
                            this.interpLinesGroup.add(line);
                        }
                        line.visible = true;
                        
                        const pts = [];
                        for(let i=0; i<buffer.count; i++) {
                            const st = buffer.states[(buffer.head - buffer.count + i + 3) % 3];
                            pts.push(new THREE.Vector3(st.posX, st.posY, st.posZ));
                        }
                        const newGeom = new THREE.BufferGeometry().setFromPoints(pts);
                        line.geometry.dispose();
                        line.geometry = newGeom;
                    }
                }
            }
        }

         // Drone Colliders
        if (this.droneCollidersGroup) {
            this.droneCollidersGroup.visible = vis.colliders;
            if (vis.colliders) {
                this.activeDronesThisTick.clear();
                for (const [id, buffer] of (this.match as any).droneJitterMap.entries()) {
                    if (buffer.count > 0) {
                        const head = buffer.getLatest();
                        if (head.state === 5) continue; // DEAD
                        
                        const idStr = id.toString();
                        this.activeDronesThisTick.add(idStr);
                        
                        let mesh = this.droneColliderMeshes.get(idStr);
                        if (!mesh) {
                            mesh = new THREE.Mesh(this.droneSphereGeom, this.droneWireMat);
                            this.droneColliderMeshes.set(idStr, mesh);
                            this.droneCollidersGroup.add(mesh);
                        }
                        mesh.visible = true;

                        // Update mesh geometry and scale to match Rapier shapes
                        const type = head.type;
                        const config = DRONE_CONFIGS[type];
                        if (config && config.collider) {
                            if (config.collider.type === 'capsule') {
                                if (mesh.geometry !== this.droneCapsuleGeom) mesh.geometry = this.droneCapsuleGeom;
                                const radius = config.collider.radius || 0.8;
                                const halfHeight = config.collider.halfHeight || 1.0;
                                const totalHeight = 2.0 * halfHeight + 2.0 * radius;
                                mesh.scale.set(radius, totalHeight / 4.0, radius);
                            } else if (config.collider.type === 'cuboid' && config.collider.halfExtents) {
                                if (mesh.geometry !== this.droneBoxGeom) mesh.geometry = this.droneBoxGeom;
                                mesh.scale.set(config.collider.halfExtents[0], config.collider.halfExtents[1], config.collider.halfExtents[2]);
                            } else {
                                if (mesh.geometry !== this.droneSphereGeom) mesh.geometry = this.droneSphereGeom;
                                const radius = config.collider.radius || 1.5;
                                mesh.scale.set(radius, radius, radius);
                            }
                        } else {
                            if (mesh.geometry !== this.droneSphereGeom) mesh.geometry = this.droneSphereGeom;
                            mesh.scale.set(1.5, 1.5, 1.5);
                        }

                        let offsetOffsetY = 0;

                        mesh.position.set(head.posX, head.posY + offsetOffsetY, head.posZ);
                        const yawAngle = 2 * Math.atan2(head.rotY, head.rotW);
                        mesh.rotation.y = yawAngle;
                    }
                }
                
                // Cleanup dead/missing
                for (const [id, mesh] of this.droneColliderMeshes.entries()) {
                    if (!this.activeDronesThisTick.has(id)) {
                        mesh.visible = false;
                    }
                }
            }
        }

        // Server Cubes Toggle
        if ((window as any).serverCubeMesh) {
            (window as any).serverCubeMesh.visible = vis.serverCubes;
        }
        
        // AI Sight & Info
        if (this.aiTextContainer) {
            this.aiTextContainer.innerHTML = "";
            this.aiSightGroup!.visible = vis.aiSight;

            // Dispose old sight lines to prevent memory leaks
            while (this.aiSightGroup!.children.length > 0) {
                const child = this.aiSightGroup!.children[0] as THREE.LineSegments;
                child.geometry.dispose();
                this.aiSightGroup!.remove(child);
            }

            if (vis.aiSight && (window as any).camera) {
                const camera = (window as any).camera as THREE.PerspectiveCamera;
                const sightPositions: number[] = [];
                
                for (const [id, buffer] of this.match.droneJitterMap.entries()) {
                    if (buffer.count > 0) {
                        const head = buffer.states[(buffer.head - 1 + 3) % 3];
                        if (head.state === 5) continue; // DEAD
                        
                        // Floating Text
                        const pos = new THREE.Vector3(head.posX, head.posY + 2, head.posZ);
                        const posScreen = pos.clone().project(camera);
                        
                        if (posScreen.z < 1) { // In front of camera
                            const x = (posScreen.x * 0.5 + 0.5) * window.innerWidth;
                            const y = (-(posScreen.y * 0.5) + 0.5) * window.innerHeight;
                            
                            const div = document.createElement("div");
                            div.style.position = "absolute";
                            div.style.left = `${x}px`;
                            div.style.top = `${y}px`;
                            div.style.transform = "translate(-50%, -100%)";
                            div.style.color = "#0f0";
                            div.style.background = "rgba(0,0,0,0.7)";
                            div.style.padding = "2px 4px";
                            div.style.fontSize = "10px";
                            div.style.fontFamily = "monospace";
                            div.style.whiteSpace = "pre";
                            
                            let stateName = "IDLE";
                            if (head.state === 1) stateName = "PATROL";
                            if (head.state === 2) stateName = "PURSUIT";
                            if (head.state === 3) stateName = "ATTACK";
                            if (head.state === 4) stateName = "REPOS";
                            
                            let text = `ID:${id} ${stateName}\nMode:${(head as any).mode || 'N/A'}`;
                            if ((head as any).memory && (head as any).memory.length > 0) {
                                text += `\nTargets:${(head as any).memory.length}`;
                            }
                            
                            div.innerText = text;
                            this.aiTextContainer.appendChild(div);
                        }
                        
                        // Build Sight Cone wireframe points
                        const origin = new THREE.Vector3(head.posX, head.posY, head.posZ);
                        const forwardAngle = 2 * Math.atan2(head.rotY, head.rotW);
                        const sightDist = 30;

                        const forward = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), forwardAngle);
                        const centerEnd = origin.clone().add(forward.clone().multiplyScalar(sightDist));
                        sightPositions.push(origin.x, origin.y, origin.z, centerEnd.x, centerEnd.y, centerEnd.z);

                        const leftDir = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), forwardAngle - 0.35);
                        const leftEnd = origin.clone().add(leftDir.multiplyScalar(sightDist));
                        sightPositions.push(origin.x, origin.y, origin.z, leftEnd.x, leftEnd.y, leftEnd.z);

                        const rightDir = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), forwardAngle + 0.35);
                        const rightEnd = origin.clone().add(rightDir.multiplyScalar(sightDist));
                        sightPositions.push(origin.x, origin.y, origin.z, rightEnd.x, rightEnd.y, rightEnd.z);

                        // Connect Left and Right
                        sightPositions.push(leftEnd.x, leftEnd.y, leftEnd.z, rightEnd.x, rightEnd.y, rightEnd.z);
                    }
                }

                if (sightPositions.length > 0) {
                    const sightGeom = new THREE.BufferGeometry();
                    sightGeom.setAttribute('position', new THREE.Float32BufferAttribute(sightPositions, 3));
                    const lineSegments = new THREE.LineSegments(
                        sightGeom,
                        new THREE.LineBasicMaterial({ color: 0x00ffff, depthTest: false })
                    );
                    lineSegments.renderOrder = 999;
                    this.aiSightGroup!.add(lineSegments);
                }
            }
        }
    }

    public dispose() {
        if (this.bulletLines) {
            this.match.scene.remove(this.bulletLines);
            this.bulletLines.geometry.dispose();
            (this.bulletLines.material as THREE.Material).dispose();
        }
        if (this.hitSpheres) {
            this.match.scene.remove(this.hitSpheres);
        }
        if (this.zoneBorders) {
            this.match.scene.remove(this.zoneBorders);
        }
        if (this.aiSightGroup) {
            this.match.scene.remove(this.aiSightGroup);
        }
        if (this.aiTextContainer && this.aiTextContainer.parentNode) {
            this.aiTextContainer.parentNode.removeChild(this.aiTextContainer);
        }
    }
}
