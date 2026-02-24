# Parascene Provider Server

A dead-simple, barebones Vercel serverless function that implements image generation for the Parascene platform.

## Overview

This is a minimal reference implementation of a provider server. It generates images using the same logic as the main Parascene system - creating 1024x1024 PNG images with gradient backgrounds and circles.

## API Endpoint

### `/api`

Single endpoint that handles both status checks and image generation based on HTTP method.

#### GET - Capabilities

Returns server status and supported generation methods with their requirements.

**Request:**
- Method: `GET`

**Response:**
```json
{
  "status": "operational",
  "region": "us-east-1",
  "uptime_pct": 100.0,
  "capacity_pct": 50.0,
  "last_check_at": "2024-01-01T00:00:00.000Z",
  "methods": {
    "gradientCircle": {
      "name": "Gradient Circle",
      "description": "Generates a 1024x1024 image with a gradient background using random colors at each corner and a random colored circle",
      "fields": {}
    },
    "centeredTextOnWhite": {
      "name": "Centered Text on White",
      "description": "Generates a 1024x1024 image with centered text rendered on a white background",
      "fields": {
        "text": {
          "label": "Text",
          "type": "text",
          "required": true
        },
        "color": {
          "label": "Text Color",
          "type": "color",
          "required": false
        }
      }
    }
  }
}
```

**Example:**
```bash
curl https://your-deployment.vercel.app/api
```

#### POST - Generate Image

Generates an image using a specified method.

**Request:**
- Method: `POST`
- Body: JSON object with:
  - `method` (required): Name of the generation method to use
  - `args` (optional): Object containing method-specific arguments

**Example Requests:**

Gradient Circle (no arguments):
```json
{
  "method": "gradientCircle",
  "args": {}
}
```

Centered Text on White (with required text and optional color):
```json
{
  "method": "centeredTextOnWhite",
  "args": {
    "text": "Hello World",
    "color": "#ff0000"
  }
}
```

**Response:**
- Content-Type: `image/png`
- Headers:
  - `X-Image-Color`: Primary color used
  - `X-Image-Width`: Image width (1024)
  - `X-Image-Height`: Image height (1024)
- Body: PNG image binary data

**Examples:**
```bash
# Generate gradient circle
curl -X POST https://your-deployment.vercel.app/api \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -d '{"method": "gradientCircle", "args": {}}' \
  --output gradient.png

# Generate centered text image
curl -X POST https://your-deployment.vercel.app/api \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -d '{"method": "centeredTextOnWhite", "args": {"text": "Hello World", "color": "#ff0000"}}' \
  --output text.png
```

## Development

### Local Development

1. Install dependencies:
```bash
npm install
```

2. Run Vercel dev server:
```bash
npm run dev
```

3. Test endpoints:
```bash
# Check capabilities (no auth required)
curl http://localhost:3000/api

# Generate gradient circle (auth required)
curl -X POST http://localhost:3000/api \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -d '{"method": "gradientCircle", "args": {}}' \
  --output gradient.png

# Generate centered text image (auth required)
curl -X POST http://localhost:3000/api \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -d '{"method": "centeredTextOnWhite", "args": {"text": "Hello World"}}' \
  --output text.png
```

## Deployment

### Deploy to Vercel

1. Install Vercel CLI (if not already installed):
```bash
npm i -g vercel
```

2. Deploy:
```bash
vercel
```

3. Follow the prompts to link your project or create a new one.

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `PARASCENE_API_KEY` | Yes | API key for authorizing POST requests |
| `OPENAI_API_KEY` | For AI methods | OpenAI API key for poem generation and Dall-E (`poeticImage`, `fluxPoeticImage`) |
| `FLUX_API_KEY` | For Flux methods | Black Forest Labs API key for Flux image generation (`fluxImage`, `fluxPoeticImage`) |

Set in Vercel dashboard or copy `.env.example` to `.env` for local development.

## Dependencies

- `sharp` - For SVG to PNG conversion and image processing

## Notes

- This is a barebones implementation with no authentication
- Images are generated on-demand with random colors
- No database or persistent storage
- Suitable as a reference implementation for building more complex provider servers
