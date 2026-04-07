# AE Enhanced

**A man-in-the-middle proxy for Dark Ages that doesn't just watch traffic — it rewrites the game.**

AE Enhanced sits between your Dark Ages client and the server, intercepting every packet in both directions. On top of that foundation, it layers entirely new gameplay systems that exist only in the proxy — virtual NPCs, custom maps, monster catching, fishing, a parallel AFK dimension, full combat automation, and more. No server mods. No client patches. The real server never knows.

---

## Rewrite the World — Map Editor & Map Swapping

Reshape Temuair and Medenia without touching the server. Swap any map's terrain for another in real time, place and edit virtual objects and NPCs anywhere in the world, create custom doors and portals that teleport players between maps, and drop animated exit markers so players always know where to go. Every change pushes to connected players instantly — no restart, no downtime. Build custom dungeons, reshape towns, create hidden areas. The world is yours to edit.

---

## Full Packet Control

Every packet flows through the proxy's pipeline — decrypt, inspect, modify, re-encrypt. Block what you don't want, inject what you do. Separate encryption state per session, per direction. Persistent packet capture to a database for analysis and protocol documentation over time, with AI-assisted decoding tools built in.

---

## Virtual NPC System

Inject fully interactive NPCs that only proxy clients can see. The server has no idea they exist. They show and hide based on map and proximity, support full dialog and menu interactions, can speak in local chat, and trigger custom logic when players walk near them. Reposition real server NPCs too — the override sticks whenever a player enters range.

---

## Automation Engine

The proxy can play your session. A* pathfinding with live collision data, cross-map navigation using a learned map graph, full combat automation with target filtering and engagement modes, spell and skill casting by name, threshold-based healing, automatic looting with allowlists, buff and debuff tracking, follow mode, and realistic input delays so it looks human. A desync monitor keeps everything in sync if the proxy drifts from the server.

---

## Monster Capture

A Pokemon-style monster-catching system running entirely inside the proxy. Wild encounters trigger from movement on configured maps. Catch monsters, build a roster, level them up, battle other players. Your active monster spawns as a visible companion NPC that follows you around the world.

---

## Fishing

A real fishing minigame — not a loot roll. Virtual fishing NPCs with rod selection, multiple species across rarity tiers and size classes, dynamic hotspot rotation, and a full bite-to-catch simulation. Catch history, personal bests, and leaderboards.

---

## AFK Shadow Dimension

Go AFK and keep progressing. The proxy blocks all real server packets and takes over, simulating a complete parallel world — custom maps, shadow monsters with real combat, separate inventory and progression, loot tables, merchants, and group play. Your character stays visible on the real server while you play in another dimension.

---

## Custom Legends & Disguises

Rewrite player identity through the proxy. Custom legend marks with full icon and color control, disguise profiles that change how you appear, and per-player name tag styling.

---

*AE Enhanced is under active development. New proxy systems are added regularly.*
