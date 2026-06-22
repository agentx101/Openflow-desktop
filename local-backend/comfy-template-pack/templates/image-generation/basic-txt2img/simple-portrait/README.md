# Simple Portrait Generator

## Description
A straightforward text-to-image workflow optimized for generating high-quality portraits. This template uses a basic setup with Stable Diffusion 1.5 and is perfect for beginners learning ComfyUI.

## Preview
![Preview](preview.png)

## Requirements
- **ComfyUI Version**: 0.1.0+
- **Required Models**: 
  - [Realistic Vision V5.1](https://civitai.com/models/4201/realistic-vision-v51) - High-quality realistic portrait model
- **Custom Nodes**: None (uses only built-in nodes)
- **Hardware Requirements**: 
  - RAM: 8 GB minimum
  - VRAM: 6 GB minimum (SDXL compatibility)
  - Storage: 5 GB for models

## Usage
1. Download the Realistic Vision V5.1 model and place it in `ComfyUI/models/checkpoints/`
2. Import the workflow.json into ComfyUI
3. Load the workflow 
4. Modify the prompt in the "CLIP Text Encode (Prompt)" node
5. Adjust seed for variation (set to -1 for random)
6. Queue the prompt and generate!

## Parameters
### Key Settings
- **Prompt**: Describe the portrait you want (e.g., "portrait of a woman with curly hair, professional lighting")
- **Negative Prompt**: What to avoid (default includes "blurry, low quality, distorted")
- **Steps**: 20-30 for good quality (default: 25)
- **CFG Scale**: 7-9 for balanced creativity (default: 8)
- **Seed**: Set to -1 for random, or use a specific number for reproducible results
- **Resolution**: 512x768 (portrait ratio) or 512x512 (square)

### Advanced Options
- **Sampler**: DPM++ 2M Karras (good balance of quality and speed)
- **Scheduler**: Karras (recommended for this model)

## Tips & Tricks
- Start with simple prompts and gradually add details
- Use "professional lighting, high quality, detailed" for better results
- Experiment with different aspect ratios by changing width/height
- For consistent characters, note down successful seeds
- Add art styles like "oil painting style" or "photography style" for variety

## Examples
The examples folder contains:
- **professional_woman.png**: Business portrait with professional attire
- **artistic_man.png**: Creative portrait with dramatic lighting
- **casual_portrait.png**: Everyday portrait with natural lighting

## Credits
- **Author**: ComfyUI Community
- **Based on**: Standard Stable Diffusion workflow
- **License**: MIT
- **Date**: December 2024

## Changelog
- **v1.0** (2024-12-15): Initial release with Realistic Vision V5.1 support
