Understood. I acknowledge the requested protocol and workflow rules in full:
Bullet Point First: Start with the exact bullet point as provided.
Investigation: Document the findings from code inspection, using exact quoted code, paths, and patterns. No prose summarizing what code "does" without showing it.
Plan: Outline a precise implementation strategy adhering strictly to ARCHITECTURE.md.
Testing: Define the validation strategy, test commands, and manual checklist before and after modification.
Report: Generate a clean, descriptive report markdown file tracking the completion of the investigation, plan, testing, and implementation.
Session End: End the turn cleanly once all points are addressed without calling unnecessary tools.

## Tasks

1. [COMPLETE] We need a unified surface for common things rather than random implementations. For example drag and pan and zoom. Some areas they're great. Some others not so much. They should all be the same. Why does the map editor have a different implementation than the ai nav map which is also different than the expanded minimap? They are all the same functions on a flat panel yet completely different in quality. Again. Standard modular surface. This applies to many other things. You will find 5 others.

2. [COMPLETE] Similar to the first issue. We need a unified surface for touch and click blocking. Since right now clicking at the wrong time may brick the page. For example, loading screens, splash screens, waiting, ui editor (input gating, not blocking the actual editor. Since right now touching buttons like the settings icon while moving the ui may accidentally exit out the ui editor). And when the minimap is open (require clicking outside it to remove it without accidentally clicking something else).

3. Vfx. I wanted a new folder specifically for improving visual effects. Independent files for the firing sequence. File for hit effect sparks or decals or dirt. File for larger effects like explosions or fire or smoke. Modular of course because why? You will have to refer to threejs examples for +184 webgpu. I need to see exact references on your report to achieve something like the Niagara muzzle flash. Of course done forget that we have a literal constants file so no hardcoded values.

4. Smooth experience. Right now although we are prewarming some things, others aren't really prewarmed. For example after spawning the player spawns looking at the wrong direction. When turning around there is an immediate lag spike when the builds first show up. These are 2 issues.

5. No to mention, the loading screen disappears way before the player is actually ready. There is still a few seconds of lag. Meaning the ready signal was sent at the wrong time to the server. Check if it's a real loading screen since it's possibly a hardcoded fake waiting value.

6. The turn timer is a misnomer. Find every mention and renamed to "Time Left" the server needs to reflect that too. Meaning depending on the game mode that text may change and i believe the default values (config not hardcoded in the wrong place) are 10 minutes counting down.

7. The compass area. Create a new file for it to manage it. With the ability to place things and have it track them (meaning we could for example place the eye logo and have the compass track it if it comes within 90 degrees or something. Don't hardcode a specific thing, that's just as example.

8. Smoothness of the gameplay. So far we haven't expanded the constants with the new values. Since we wanted curves for the transition from walking to running. Curves so the weapon isn't following the camera dead on point. For example if the player drags or moves the mouse to the side then it's normal, but the harder they snap the more this "catch up" effect appears. Nothing too exaggerated but should still be here, again not hardcoded as a magic number. These must be adjustable easily.

9. Same as point 8. But this time for other small effects like bobbing per step. Smooth of course with curves. Miniature Tilting on hard runs combined with sharp turns. Miniature player model pull backwards when running fast for some time. I think you get the point. A new folder for camera effects along with its constants and curves and such smoothness. I mentioned a few but you can think of more.

10. Sound. So far we have been ignoring it. For a start. In the ui and voice are the same slider. They should be their own seperate sliders. Second we need pitch variation. Just small pitch variations per shot. Per click. Per step. Per..... Just breaking monotony. And the sound for distance effect isn't working anyway. It's more like a sharp cutoff at a specific distance. This needs to be fixed.
