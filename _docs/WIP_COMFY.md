

https://www.parascene.com/s/v1/AAShAAAa.8-_DNk29yM9p/tadcbl

```
{
"6": { "class_type": "CLIPTextEncode", "inputs": { "clip": [ "40", 0 ],
     "text": "high-quality cartoon mascot anthropomorphic cigarette, full body, centered, playful but clear tone. Exact structure of subject from bottom to top (do not change): 1) bottom 1/3: brown filter with subtle fake texture speckles, 2) middle/top 2/3: long smooth **white** paper body and face, 3) very top: small ashy cap with thin gray smoke rising. The cigarette is tall and slender with expressive cartoon arms, hands, legs, and feet, friendly face, readable silhouette, sharp focus, vibrant but balanced colors. Add a comic-style speech bubble with this exact text: \"Hey, kids! Smoking is good for you!\""
}},
"30": { "class_type": "CheckpointLoaderSimple", "inputs": {
      "ckpt_name": "flux1-dev-fp8.safetensors",
      "ckpt_name_bak": "OpenFlux-fp8_e4m3fn.safetensors"
}},
"40": { "class_type": "CLIPLoader", "inputs": {
      "clip_name": "t5xxl_fp16.safetensors",
      "type": "sd3"
}},
"41": { "class_type": "VAELoader", "inputs": {
      "vae_name": "ae.safetensors"
}},
"31": { "class_type": "KSampler", "inputs": {
      "seed": 1119851866655636,
      "steps": 40,
      "cfg": 1,
      "sampler_name": "euler",
      "sampler_name_bak": "dpmpp_2m",
      "scheduler": "beta",
      "denoise": 1,
      "model": ["30", 0 ],
      "positive": [ "35", 0 ],
      "negative": [ "33", 0 ],
      "latent_image": ["27", 0 ]
}},
"35": { "class_type": "FluxGuidance", "inputs": { "guidance": 3.5, "conditioning": ["6",0] }},
"27": { "class_type": "EmptySD3LatentImage", "inputs": { "width": 1024, "height": 1024, "batch_size": 1 }},
"8": { "class_type": "VAEDecode", "inputs": { "samples": ["31", 0 ], "vae": ["41", 0 ] }},
"9": { "class_type": "SaveImage", "inputs": { "filename_prefix": "ComfyUI", "images": ["8", 0] }},
"33": { "class_type": "CLIPTextEncode", "inputs": { "text": "", "clip": ["40", 0 ] }}
}
```