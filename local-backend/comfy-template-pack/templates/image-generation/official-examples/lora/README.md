# LoRA (Low-Rank Adaptation)

Official LoRA workflow - fine-tune models with specialized concepts, styles, or characters.

## ⚡ 60-Second Setup

### What it does
Applies LoRA (Low-Rank Adaptation) models to add specific styles, characters, or concepts to Stable Diffusion generation.

### Requirements
- **ComfyUI Version:** Any version (core nodes only)
- **VRAM:** 4GB minimum, 6GB+ recommended
- **Runtime:** ~20-40 seconds per image

### Required Models
```
ComfyUI/models/checkpoints/v1-5-pruned-emaonly.safetensors (4GB)
ComfyUI/models/loras/[your-lora-file].safetensors (varies, typically 10-200MB)
```
📥 **Popular LoRAs:** [CivitAI](https://civitai.com/), [HuggingFace LoRA Hub](https://huggingface.co/models?other=lora)

### Custom Nodes Required
- **None** - Uses ComfyUI core nodes only ✅

### Last Verified
- **Date:** January 2025
- **ComfyUI SHA:** Latest stable
- **Status:** ✅ Works on clean install

---

## 🚀 Quick Usage

### 1. Get the Official Workflow
**Method A: From ComfyUI Examples (Recommended)**
1. Visit [ComfyUI LoRA Examples](https://comfyanonymous.github.io/ComfyUI_examples/lora/)
2. **Right-click any example image → Save Image**
3. **Drag the saved image into ComfyUI interface** 
4. The workflow will auto-load from the image metadata ✨

**Method B: Alternative JSON Source**
- Download from [docs.comfy.org LoRA tutorial](https://docs.comfy.org/tutorials/basic/lora)

### 2. Generate with LoRA Style
- **Base Prompt:** "portrait of a woman, detailed"
- **LoRA File:** Select from dropdown (e.g., "anime_style.safetensors")
- **LoRA Strength:** 0.7 (how strongly to apply the style)
- **CLIP Strength:** 0.7 (how much to affect text understanding)
- **Steps:** 20-30
- Click **"Queue Prompt"**

### 3. Understanding LoRA Parameters
- **Model Strength:** 0.0-2.0 (affects image generation, 0.5-1.0 typical)
- **CLIP Strength:** 0.0-2.0 (affects prompt understanding, usually match model strength)
- **Higher values:** More LoRA influence, may cause artifacts
- **Lower values:** Subtle application, more base model

## 📊 LoRA Strength Guide

| Strength | Effect | Best For |
|----------|---------|----------|
| 0.1-0.3 | Subtle influence | Minor style adjustments |
| 0.4-0.7 | Balanced blend | Most use cases |
| 0.8-1.0 | Strong application | Character/style focus |
| 1.0+ | Maximum influence | Testing, extreme effects |

## 🎯 Popular LoRA Categories

### **Art Styles**
- Anime/manga styles
- Oil painting, watercolor
- Photography styles (film, vintage)
- Digital art styles

### **Characters**
- Anime characters
- Game characters  
- Celebrity likenesses
- Original character designs

### **Concepts**
- Clothing styles
- Architectural styles
- Fantasy elements
- Technical concepts

## 🔧 Advanced Techniques

### **Multiple LoRAs**
- Chain multiple LoRALoader nodes
- Balance strengths carefully (total <1.5 recommended)
- Test combinations for compatibility

### **Prompt Integration**
- Include LoRA-specific trigger words
- Use LoRA name as prompt enhancement
- Balance positive/negative prompts

### **Troubleshooting**
- **Too strong:** Reduce strength to 0.3-0.5
- **No effect:** Increase strength, check file path
- **Artifacts:** Lower strength, improve base prompt

## 💡 How ComfyUI Examples Work

⚠️ **Important:** ComfyUI examples don't provide direct JSON downloads. Instead:

1. **Images contain embedded workflows** - Each example image has the complete workflow stored in its metadata
2. **Drag & drop extraction** - Simply drag any example image into ComfyUI to load its workflow
3. **No manual JSON editing needed** - The workflow loads automatically with all settings

This is the official method used by comfyanonymous for sharing workflows!

## 🔗 Sources & Credits
- **Technique:** Microsoft Research (LoRA paper)
- **Workflow:** [ComfyUI Official Examples](https://comfyanonymous.github.io/ComfyUI_examples/lora/)
- **LoRA Resources:** [CivitAI](https://civitai.com/), [HuggingFace](https://huggingface.co/)
- **License:** MIT - Use however you want!

---
*Essential fine-tuning technique • Endless creativity • Verified working January 2025*