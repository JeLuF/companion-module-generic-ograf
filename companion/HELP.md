## OGraf Server API

Controls [OGraf](https://ograf.ebu.io) graphics on any server that implements the **OGraf Server API** (v1): load graphics onto render targets, play, stop and update them, and call their custom actions.

### Setup

Enter the **API base URL** of the server, e.g. `https://graphics.example.com/ograf/v1`. Servers may use any path prefix, and some put an access token into it, so the URL is stored as a secret.

The module fetches the renderers, their render targets and the available graphics at the status update interval. Dropdowns and presets follow what the server reports.

### Actions

- **Graphic: Play**: loads the graphic onto the render target if it is not there (or has played through), then calls `playAction`. While it is on air, each further Play advances to the next step.
- **Graphic: Play/Stop**: stops the graphic when it is on air, plays it otherwise.
- **Graphic: Stop**: calls `stopAction`; by default the instance is removed afterwards, so the next Play loads the graphic again with fresh data.
- **Graphic: Load**, **Graphic: Update**: `load` and `updateAction` with data.
- **Graphic: Custom action**: a custom action declared in the graphic's manifest, with a JSON payload.
- **Target: Clear**, **Renderer: Clear all**: remove graphics at once, without animating out.
- **Renderer: Custom action**: shown when a renderer declares custom actions.

**Data** is JSON (Companion variables allowed). Leave it empty to use the default values of the graphic's schema.

### Feedbacks

- **Graphic: On air**: the graphic was played and not stopped.
- **Graphic: Loaded**: a graphic instance is on the target.
- **Renderer: Status OK**

The OGraf Server API reports which graphics are loaded on a target, but not whether they are playing. The module therefore tracks _on air_ from its own actions, using the graphic's `stepCount` and the `currentStep` answers. Graphics played by other controllers count as loaded only. Servers that report `playing`/`ended` for graphic instances (e.g. Grafonaut) are trusted instead.

### Variables

- `on_air_count`, `on_air_names`
- Per renderer: `renderer_<id>_status`
- Per render target: `target_<id>_name`, `target_<id>_graphic`, `target_<id>_state` (`on air`, `loaded`, `played`, `empty`). `<id>` is made of the target's values, e.g. `target_1_14` for `{ "bank": 1, "layer": 14 }`.

### Presets

Per render target: Play/Stop (red while on air), Play, Stop and the custom actions of its graphics, and Clear. A target's graphics are the ones seen on it; for targets that never had one, all graphics are offered (when there are not too many combinations). Per renderer: status and Clear all.

### Extensions

Group actions (`GET/POST /x-actions`, a vendor extension of Grafonaut) are offered only when the server answers `GET /x-actions`: **Group action: Run**, the feedback **Group action: Running** and presets.
