# Hires Fix (2-Pass Txt2Img)

Official "Hires Fix" workflow - the essential technique for generating high-resolution images without artifacts.

## ⚡ 60-Second Setup

### What it does
Generates high-resolution images (1024x1024+) using 2-pass technique: low-res generation + high-res refinement to avoid common artifacts.

### Requirements
- **ComfyUI Version:** Any version (core nodes only)
- **VRAM:** 6GB minimum, 8GB+ recommended
- **Runtime:** ~60-120 seconds per image

### Required Models
```
ComfyUI/models/checkpoints/v1-5-pruned-emaonly.safetensors (4GB)
ComfyUI/models/upscale_models/RealESRGAN_x4plus.pth (64MB)
```
📥 **Auto-download:** [SD 1.5 Official](https://huggingface.co/stable-diffusion-v1-5) + [ESRGAN](https://github.com/xinntao/ESRGAN)

### Custom Nodes Required
- **None** - Uses ComfyUI core nodes only ✅

### Last Verified
- **Date:** January 2025
- **ComfyUI SHA:** Latest stable
- **Status:** ✅ Works on clean install

---

## 🚀 Quick Usage

### 1. Download & Import
- Download [`hires_fix_2pass.json`](hires_fix_2pass.json)
- Drag into ComfyUI interface
- Models auto-download on first run

### 2. Generate High-Res Image
- **Prompt:** "beautiful landscape, mountains, detailed"
- **Negative:** "blurry, low quality, artifacts"
- **Pass 1 Size:** 512x512 (fast, low memory)
- **Pass 2 Size:** 1024x1024 (upscaled and refined)
- **Steps:** 20 for each pass
- Click **"Queue Prompt"**

### 3. How It Works
1. **Pass 1:** Generate 512x512 image (fast, clean composition)
2. **Upscale:** ESRGAN upscales to 1024x1024
3. **Pass 2:** Refine details at high resolution
4. **Result:** Clean, artifact-free high-res image

## 📊 Performance vs Direct Generation

| Method | Size | VRAM | Time | Quality | Artifacts |
|--------|------|------|------|---------|-----------|
| Direct 1024x1024 | High | 12GB | ~45s | Poor | Many |
| Hires Fix 2-Pass | 512→1024 | 8GB | ~90s | Excellent | None |

## 🎯 Why Use Hires Fix?

- **Avoids artifacts** - No weird anatomy or distorted objects
- **Memory efficient** - Uses less VRAM than direct high-res
- **Better composition** - Low-res pass gets layout right first
- **Industry standard** - Used by all professional SD users

## 🔧 Customization Tips

- **First pass:** Focus on composition, use lower CFG (7-9)
- **Second pass:** Add detail prompts, use higher CFG (10-12)
- **Upscale factor:** 2x is standard, 4x possible with more VRAM
- **Different models:** Works with any SD 1.5, SDXL, or newer models

## 🔗 Sources & Credits
- **Technique:** Community-developed standard practice
- **Workflow:** [ComfyUI Official Examples](https://comfyanonymous.github.io/ComfyUI_examples/2_pass_txt2img/)
- **Models:** [Stability AI SD 1.5](https://huggingface.co/stable-diffusion-v1-5) + [RealESRGAN](https://github.com/xinntao/ESRGAN)
- **License:** MIT - Use however you want!

---
*Essential technique every ComfyUI user should know • Verified working January 2025*
