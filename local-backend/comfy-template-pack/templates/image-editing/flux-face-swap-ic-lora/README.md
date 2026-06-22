# Flux Face Swap (IC-LoRA)

Inpainting-based face swap using FLUX + IC-LoRA helpers. Manual face mask on the **body** image; swap quality depends on mask size/shape.

## Requires
- Custom nodes: see `custom_nodes.txt`
- Models: see `models.txt`

## How to use
1. Open ComfyUI and **Import** `flux_face_swap_ic_lora.json` (or drag the PNG that contained the workflow).
2. In **FACE** (`LoadImage`), select your source face image.
3. In **BODY (ADD MASK TO FACE)**, select target image and its mask (or create via ComfyUI mask editor).
4. Point loaders to the listed model files and run.

### Tips
- Similar aspect ratios for face/body inputs reduce resize issues.
- Start with sampler `res_2s`, scheduler `beta57`, steps ≈10; adjust guidance/strength as needed.

## Credits
See `CREDITS.md`.

## Safety & rights
This folder **does not** include third-party images or models. Use your own images and ensure you have rights to them.

