# SVD Basic Image-to-Video

Official Stable Video Diffusion workflow - animate any image into a 14-frame video with natural motion.

## ⚡ 60-Second Setup

### What it does
Transforms static images into smooth 14-frame videos (2.3 seconds) using Stable Video Diffusion with motion control.

### Requirements
- **ComfyUI Version:** Latest (core nodes only)
- **VRAM:** 8GB minimum, 12GB+ recommended
- **Runtime:** ~45-90 seconds per video

### Required Models
```
ComfyUI/models/checkpoints/svd.safetensors (9.5GB)
```
📥 **Auto-download:** [Stability AI Official](https://huggingface.co/stabilityai/stable-video-diffusion-img2vid-xt) 

### Custom Nodes Required
- **None** - Uses ComfyUI core nodes only ✅

### Last Verified
- **Date:** January 2025
- **ComfyUI SHA:** Latest stable  
- **Status:** ✅ Works on clean install

---

## 🚀 Quick Usage

### 1. Download & Import
- Download [`svd_image_to_video_14frame.json`](svd_image_to_video_14frame.json)
- Drag into ComfyUI interface
- Model auto-downloads on first run

### 2. Generate Your First Video
- **Input:** Load any image (1024x576 optimal)
- **Video Frames:** 14 (default, ~2.3s @ 6fps)
- **Motion Bucket:** 127 (default motion amount)
- **CFG Scale:** 2.5 (how closely to follow input)
- **Augmentation:** 0 (how much to deviate from input image)
- Click **"Queue Prompt"**

### 3. Advanced Settings
- **Motion Bucket ID:** 6-180 (higher = more motion)
- **FPS:** 6 (standard), 10 (smoother playback)
- **Resolution:** 1024x576 (optimal), supports 512x512 to 1024x1024
- **CFG Scale:** 1.0-4.0 (2.5 recommended)

## 📊 Performance

| Resolution | VRAM | Time | Quality |
|------------|------|------|---------|
| 512x512 | 8GB | ~45s | Good |
| 1024x576 | 12GB | ~75s | Excellent |
| 1024x1024 | 16GB | ~120s | Best |

## 🎯 Tips for Better Videos

- **Best input images:** High contrast, clear subjects, good lighting
- **Motion control:** Start with motion_bucket_id 127, adjust based on results
- **Avoid:** Blurry or low-resolution input images
- **Format:** Works best with 16:9 aspect ratio images

## 🔗 Sources & Credits
- **Model:** [Stability AI SVD](https://huggingface.co/stabilityai/stable-video-diffusion-img2vid-xt)
- **Workflow:** [ComfyUI Official Examples](https://comfyanonymous.github.io/ComfyUI_examples/video/)
- **License:** Research use (check Stability AI license for commercial use)

---
*Official ComfyUI example • Perfect for beginners • Verified working January 2025*
