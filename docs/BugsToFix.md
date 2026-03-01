- Lets make a hook (skill?), whenever the AI even THINKS about using NPX, before it tries it, it's replaced with bunx. 

- Let's make a skill about how to view debugs, to make sure that we never try to save to a tmp file outside the folder we have permissions for, and to prevent us from trying 7 different ways that don't work to view the error message in our enviornment because the AI is so unsued to being in powershell/bun/antigravity on windows. 

- We need to find a way to stop the computer from asking permission before every bun/bunx command.

- The lens profile is supposed to be part of the properties bar, not it's own seperate drop out.

- The control scheme in the ? menu is currently wrong, as shift-drag rotates, as does alt-drag and ctrl-drag does nothing. This has been a continual problem that we have fixed many times, so it is worth thinking hard about how to make a more faithful control scheme menu that reflects the actual controls, rather than what we say the controls are.

- Every mirror type currently drags in parallel to the optical table, they need to drag in perpendicular to the optical table like the lenses do.
        -Presets will need to be fixed after this
        -This is a common error when creating or modifying components, there should be a skill about orienting new components correctly and making their meshes so that the default orientation is 0,0,0 with the component such that whatever is the important W optics imaging axis being parallel with the table, so that we don't keep spawning in things flat. 

- The prism also currently drags in parallel to the optical table, so again wrong orientation.

- Blocker, aperture, iris, standard sample holder, all drag in the wrong way. The original geometry should be defined so that things drag in the right way when they have a 0,0,0 rotation. 

- The laser box itself isn't blocking rays. By default if any bit of geometry is drawn, it should block rays unless we specifically say it doesn't block rays (such as glass that lets it through, or the card viewer that doesn't interact with it). We are gonig to be making many components, and whenever we draw the color black (or black-ish) we should be blocking rays.

- I would like the main colorscheme of the program to be black/white/and the specific color blue which is (0 127 255)

- OliveSrc has a TON of glass materials, I would like us to use all the data they've put together for ourselves to our best ability.

The viewing card should have some sort of auto-scale button you can pick to make the beam view larger in the properrties box. You should also be able to scroll wheel in or out on that viewer box to zoom. Make it much more similar to how the OliveSrc viewing card lets you change the viewing properties. 

- The filter also currently drags in parallel to the optical table, so again wrong orientation. An audit should be done for all parts to make sure they are dragging in correctly. As an exmaple of something that drags in correctly, a spherical lens is dragging in correctly. 

- The interferometer uses a second beam splitter, which creates a beam that goes off in the +y to infinity for no reason. This likely should be a different part, a transparent mirror (dichoric?) of some sort. Else, the secondary beam should be terminated by a blocker.

- The viewing card should have a "block" mode that is enalbled in the properties, where it acts as a blocker. This should be clicked on in the interferometer.

- The viewing card should give a subtle graphical interaction when a ray hits it, like little colored dots where the ray hits the card, like OliverSrc does for their viewing card. 

- There is supposed to be a 2D to 3D snap, so that in 3D you have a perspective camera (unlike our current isometric camera) but in 2D you have an isometric camera to make it look really 2D. This was supposed to be taken from OliverSrc which does it great (or whatever they do, it works and looks great) but our implementation doesn't seem to be on.

- There is supposed to be a little lock symbol on each property that can be dragged (rotation, x, y, z position). So that the user can only drag in one direction, and the other direction is locked. Or they can't accidently move something they didn't want to move. Like how OliverSrc does it. Instead we have these bulky buttons "Drag" "Only X" "Only Y", which is not how we want to do it.

- There is something far more beautiful about the way OliverSrc does Rays, just each individual ray looks nicer than our individual rays.

- Make a skill (hook?) teaching the agent how to use the browser for the microscope (aka, URLS, hotkeys, never try to do anything via mouse, go back and add url/hotkey commands to help if it is trying to use the mouse)

- Make a skill about how to design a new optics piece. Aka each piece must interact with the physics correctly, look like a real thorlabs piece, block where it is supposed to block, modify light where it is supposed to modify light, be oriented right compared to the table. Something like a dual axis scan motor is very tricky for the AI to understand right now because it has a hard time thinking about how it actually works in reality, and that the program needs to represent the reality (two mirrors that don't overlap, giving a laser a well defined scan path when animated or "on"). Our test piece is the complicated Dual-Axis VantagePro® Galvanometer Scan Head Systems:
https://www.thorlabs.com/dual-axis-vantagepro-r-galvanometer-scan-head-systems-22.5-degree-scan-angle?tabName=Overview

- Make a skill about how to make a new optics setup (maybe a skill for "algin this mirror" or "align this lens"). We sort of already have this, but it isn't very robust or useful. It's just a first pass at that skill, and it's mostly inadaquete. Check that these skills are actually being used.

- The way animations should work with a camera or PMT, is they should create a playbar in the camera, and as you play or scrub that the rays and mirror angles (or whatever animated objects) that go with that image are animated. If the camera isn't selected, you just see the rays calculated from whatever image is currently playing automatically

- When we click on the eyeball, the reverse trace no longer works... which I think...we should still be able to reverse trace, and see the E&M in eyeball version on the reverse trace

- When we click on the eyeball with white light, we see hundreds of overlapping things. This is mostly not useful... perhaps we should just show three colors, red, green, blue for the eyeball when there is white light.

- Commands like Bun and Bunx require my permission every time. We need to find some way to make that not true, as Bun and Bunx are unlikely to do any damage to my computer and thus don't need my permission.

- We need better phone UI, specifically, dragging objects around should be easier, rotating the camera should be harder.

- The confocal setup is not correct yet. We haven't been able to create a realistic confocal set up yet and thus haven't been able to test the PMT component yet. Our problem currently is getting a realistic mirror raster. We keep making tthings that swing a beam huge distances in an unrealistic manner, and place the sample at the focal plane so that swinging huge distances moves the beam very little through the sample.

- Image generation for the epi reflection microscope takes a very very long time. We need to find the single slowest thing here and find a way to make it faster.

