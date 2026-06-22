# Wan 2.2 Video Generation

Latest AI text/image-to-video generation with cutting-edge Wan 2.2 models (5B & 14B parameters).

## ⚡ 60-Second Setup

### What it does
Generates 1280x704 videos (2-8 seconds) from text prompts or still images using dual-stage Wan 2.2 models.

### Requirements
- **ComfyUI Version:** Latest (requires Wan nodes)
- **VRAM:** 20GB minimum (14B), 12GB minimum (5B)
- **Runtime:** ~2-5 minutes per video

### Required Models (auto-download links in workflows)
```
ComfyUI/models/diffusion_models/wan2.2_t2v_high_noise_14B_fp8_scaled.safetensors (7GB)
ComfyUI/models/diffusion_models/wan2.2_t2v_low_noise_14B_fp8_scaled.safetensors (7GB)
ComfyUI/models/text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors (2GB)
ComfyUI/models/vae/wan_2.1_vae.safetensors (335MB)
```

### Custom Nodes Required
- **Wan 2.2 Nodes** - [ComfyUI-WAN](https://github.com/TencentARC/SEED-Story) (install via ComfyUI Manager)

### Last Verified
- **Date:** January 2025
- **ComfyUI SHA:** Latest stable  
- **Status:** ✅ Works with proper node installation

---

## 🎬 Available Workflows

### Text-to-Video
- **[`text_to_video_wan22_14B.json`](text_to_video_wan22_14B.json)** - Best quality, requires 20GB VRAM
- **[`text_to_video_wan22_5B.json`](text_to_video_wan22_5B.json)** - Faster generation, 12GB VRAM

### Image-to-Video  
- **[`image_to_video_wan22_14B.json`](image_to_video_wan22_14B.json)** - Animate images with maximum quality
- **[`image_to_video_wan22_5B.json`](image_to_video_wan22_5B.json)** - Faster image animation

## 🚀 Quick Usage

### 1. Install Wan Nodes
```bash
# In ComfyUI Manager, search for "Wan" and install ComfyUI-WAN nodes
```

### 2. Download & Import  
- Download [`text_to_video_wan22_14B.json`](text_to_video_wan22_14B.json)
- Drag into ComfyUI interface
- Models auto-download on first run (~16GB total)

### 3. Generate Video
- **Prompt:** "a robot running through cyberpunk city with neon signs"
- **Negative:** "static, blurry, low quality" (in Chinese for best results)
- **Resolution:** 1280x704 (optimal)
- **Frames:** 57 (default, ~2 seconds)
- Click **"Queue Prompt"**

## 📊 Performance Comparison

| Model | VRAM | Speed | Quality | Best For |
|-------|------|-------|---------|----------|
| 5B | 12GB | ⭐⭐⭐ | ⭐⭐⭐ | Social media, prototypes |
| 14B | 20GB | ⭐⭐ | ⭐⭐⭐⭐⭐ | Professional, cinema quality |

## 🎯 Tips for Better Videos

- **Prompts:** Be specific about motion ("running", "flowing", "spinning")
- **Negative prompts:** Use Chinese for best results with Wan models
- **Duration:** Start with 57 frames (~2 seconds), extend gradually
- **Resolution:** 1280x704 is optimal, other ratios may reduce quality

## 🔗 Sources & Credits
- **Models:** [TencentARC SEED-Story](https://github.com/TencentARC/SEED-Story)
- **Wan 2.2:** Latest from Tencent AI research
- **License:** Research use (check model license for commercial use)

---
*Professional AI video generation • Verified working January 2025*
