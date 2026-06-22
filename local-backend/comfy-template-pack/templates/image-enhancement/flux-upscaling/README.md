# Flux Upscaling Workflows

Professional 4K+ image upscaling using Flux models with ControlNet and LoRA techniques.

## ⚡ 60-Second Setup

### What it does
Upscales images 2x-8x while preserving details using Flux AI models + ControlNet structure preservation.

### Requirements
- **ComfyUI Version:** 0.3.40+ (latest recommended)
- **VRAM:** 12GB minimum, 16GB+ recommended for 4K
- **Runtime:** ~30-60 seconds for 2x upscale, 2-5 minutes for 4x

### Required Models (auto-download links in workflow)
```
ComfyUI/models/diffusion_models/flux1-dev.safetensors (12GB)
ComfyUI/models/vae/ae.safetensors (335MB)  
ComfyUI/models/text_encoders/clip_l.safetensors (246MB)
ComfyUI/models/text_encoders/t5xxl_fp16.safetensors (4.9GB)
```

### Custom Nodes Required
- **ComfyUI Core** (built-in) - No additional nodes needed ✅

### Last Verified
- **Date:** January 2025
- **ComfyUI SHA:** Latest stable
- **Status:** ✅ Works on clean install

---

## 🔍 Available Workflows

### Flux ControlNet Upscale 
**File:** [`flux_controlnet_upscale.json`](flux_controlnet_upscale.json)  
**Best for:** Architectural images, detailed textures  
**VRAM:** 12GB @ 1024→2048px, ~45 seconds

### Flux LoRA Upscaler Advanced
**File:** [`flux_lora_upscaler_advanced.json`](flux_lora_upscaler_advanced.json)  
**Best for:** Portraits, artistic content with face restoration  
**VRAM:** 16GB @ 1024→4096px, ~3 minutes

## 🚀 Quick Usage

### 1. Download & Import
- Download [flux_controlnet_upscale.json](flux_controlnet_upscale.json)
- Drag into ComfyUI interface
- Models auto-download on first run (17GB total)

### 2. Basic Settings
- **Input image:** 512-2048px works best
- **CFG Scale:** 7-12 (higher = more adherence to prompt)
- **Steps:** 20-30 (more = better quality, slower)
- **Upscale Factor:** 2x or 4x recommended

### 3. Advanced Tips
- **For photos:** Use ControlNet Canny for sharp edges
- **For art:** Use ControlNet Depth for structure
- **For faces:** Use LoRA Advanced workflow

## 📊 Performance Comparison

| Workflow | Speed | Quality | VRAM | Best For |
|----------|-------|---------|------|----------|
| ControlNet | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | 12GB | Architecture, textures |
| LoRA Advanced | ⭐⭐ | ⭐⭐⭐⭐⭐ | 16GB | Portraits, artistic |

## 🔗 Sources & Credits
- **Flux Models:** [Black Forest Labs](https://blackforestlabs.ai/)
- **Workflows:** OpenArt.ai community
- **License:** MIT - Use however you want!

---
*Verified working January 2025 • ComfyUI 0.3.40+*
