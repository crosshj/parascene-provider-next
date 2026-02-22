# Provider server payload reference

This document describes the **exact shape of data** sent from Parascene to your provider server. All communication is server-to-server (Parascene backend → your `server_url`), so this doc is the source of truth for what your server receives.

---

## How Parascene calls your server

- **HTTP:** `POST` to the server’s `server_url`
- **Headers:** `Content-Type: application/json`, `Accept` (see below), and optionally `Authorization: Bearer <server.auth_token>`
- **Body:** JSON object with two top-level keys: `method` (string) and `args` (object)

```json
{
  "method": "<method_name>",
  "args": { ... }
}
```

Your server must respond according to the method (see below). Non‑2xx responses are treated as errors; Parascene may surface `error` or `message` from a JSON body.

---

## Methods you will receive

### 1. `advanced_query` (support and cost check)

**When:** A user has opened the Advanced create tab, selected Data Builder options (and optionally a prompt), and clicked **Query**. Parascene calls you to see if you support this request and what it would cost.

**Request**

- **Method:** `advanced_query`
- **Headers:** `Accept: application/json`
- **Body:**

```json
{
  "method": "advanced_query",
  "args": {
    "items": [ ... ],
    "prompt": "optional user prompt string or absent"
  }
}
```

- **`args.items`** – Array of up to **100** items (see [Item shapes](#item-shapes) below). Omitted if the user turned on no Data Builder options (unusual in practice).
- **`args.prompt`** – Present only if the user entered text in the Advanced “Prompt” field. Omitted when empty.

**Expected response (JSON)**

- **200** with a JSON body that Parascene uses to show cost and enable **Create**:
  - `supported` (boolean) – whether you support this request
  - `cost` (number) – credits to charge per creation (e.g. `1`, `0.5`)
- Any other status or missing/invalid fields: Parascene treats the server as not supporting the request and does not charge.

---

### 2. `advanced_generate` (create image)

**When:** The user confirmed cost and clicked **Create** in the Advanced flow. Parascene has already deducted credits and created a “creating” record; your server must return the image.

**Request**

- **Method:** `advanced_generate`
- **Headers:** `Accept: image/png`
- **Body:**

```json
{
  "method": "advanced_generate",
  "args": {
    "items": [ ... ],
    "prompt": "optional user prompt string or absent"
  }
}
```

- **`args.items`** – Same as in `advanced_query`: up to 100 items (see [Item shapes](#item-shapes)).
- **`args.prompt`** – Same as in `advanced_query`: present only when the user entered a prompt.

**Expected response**

- **200** with body **image/png** (binary). Parascene stores this and marks the creation complete.
- Non‑2xx or non‑PNG: Parascene marks the job failed and may refund credits; error details can come from your JSON `error` / `message`.

---

## Item shapes

Every item in `args.items` is an object. Each has a **`type`** and **`source`** so you can tell where it came from. All IDs and counts are as returned by Parascene; strings may be empty; optional fields are omitted when not set.

### Common conventions

- **`image_id`** – The Parascene creation (image) this piece of content refers to. Same creation can appear in multiple items (e.g. a post and a comment on that post).
- **`image_url`** – Share URL your server can use to fetch the image (GET, no auth). Use this if you need the actual pixels. Optional; can be `null` if not available.
- **`created_at`** – ISO 8601 timestamp string (e.g. `"2025-02-04T12:00:00.000Z"`).
- **`description`** – User-written description of the **creation** (the image). Only present when the creator set one.
- **`creation_meta`** – Object describing **how that creation was made** (inputs, server/method, lineage). Only present when we have that data. Shape:
  - `args` (object) – Inputs used to generate the image (e.g. `{ "prompt": "..." }`).
  - `method_name` (string) – Human-readable method name.
  - `server_name` (string) – Name of the server that produced the image.
  - `history` (array of numbers) – Lineage: creation IDs from root → … → parent (ordered chain).
  - `mutate_of_id` (number) – Direct parent creation ID when this creation was made from another (mutate flow).

---

### Type: `comment` (source: `recent_comments`)

Latest comments across the platform, each tied to a creation.

| Field          | Type   | Description |
|----------------|--------|-------------|
| `type`         | string | `"comment"` |
| `source`       | string | `"recent_comments"` |
| `id`           | number | Comment ID |
| `text`         | string | Comment body |
| `created_at`   | string | ISO 8601 |
| `author`       | string \| null | Commenter display name or username |
| `image_url`    | string \| null | Share URL for the creation image |
| `image_id`     | number \| null | Creation (image) ID |
| `image_title`  | string \| null | Title of that creation |
| `description`  | string \| null | *(optional)* Creation description |
| `creation_meta`| object \| null | *(optional)* `{ args?, method_name?, server_name?, history?, mutate_of_id? }` for that creation |

---

### Type: `post` (source: `recent_posts`)

Feed items for “newest” creations (all published on the platform, newest first; one per creation).

| Field          | Type   | Description |
|----------------|--------|-------------|
| `type`         | string | `"post"` |
| `source`       | string | `"recent_posts"` |
| `id`           | number | Feed item ID |
| `title`       | string | Creation title |
| `summary`      | string | Creation summary |
| `created_at`   | string | ISO 8601 |
| `author`       | string \| null | Creator display name or username |
| `image_url`    | string \| null | Share URL for the creation image |
| `image_id`     | number \| null | Creation ID |
| `like_count`   | number | Like count |
| `comment_count`| number | Comment count |
| `description`  | string \| null | *(optional)* Creation description |
| `creation_meta`| object \| null | *(optional)* Creation inputs and method/server |

---

### Type: `image` (source: `top_likes`, `bottom_likes`, or `most_mutated`)

Creations from the platform: **top_likes** / **bottom_likes** are all published creations sorted by like count (most or least); **most_mutated** are creations that appear most in mutation lineages (meta.history). Here `id` is the creation (image) ID.

| Field          | Type   | Description |
|----------------|--------|-------------|
| `type`         | string | `"image"` |
| `source`       | string | `"top_likes"`, `"bottom_likes"`, or `"most_mutated"` |
| `id`           | number | Creation (image) ID |
| `title`       | string | Creation title |
| `summary`      | string | Creation summary |
| `created_at`   | string | ISO 8601 |
| `author`       | string \| null | Creator display name or username |
| `image_url`    | string \| null | Share URL for the creation image |
| `like_count`   | number | Like count |
| `comment_count`| number | Comment count |
| `description`  | string \| null | *(optional)* Creation description |
| `creation_meta`| object \| null | *(optional)* Creation inputs and method/server |

---

## Example payload (advanced_query / advanced_generate)

In examples, `<app-origin>` is the app base URL (from `getBaseAppUrl()` in code, or `APP_ORIGIN` env).

```json
{
  "method": "advanced_query",
  "args": {
    "items": [
      {
        "type": "comment",
        "source": "recent_comments",
        "id": 42,
        "text": "Love the colors in this one!",
        "created_at": "2025-02-04T14:30:00.000Z",
        "author": "alice",
        "image_url": "<app-origin>/api/share/v1/abc123/image",
        "image_id": 101,
        "image_title": "Sunset over the lake",
        "description": "A quick sketch from the train.",
        "creation_meta": {
          "args": { "prompt": "sunrise over the city, sketch style" },
          "method_name": "Image generation",
          "server_name": "Default server"
        }
      },
      {
        "type": "post",
        "source": "recent_posts",
        "id": 201,
        "title": "Morning sketch",
        "summary": "Quick doodle from the train.",
        "created_at": "2025-02-04T12:00:00.000Z",
        "author": "bob",
        "image_url": "<app-origin>/api/share/v1/def456/image",
        "image_id": 202,
        "like_count": 5,
        "comment_count": 2,
        "description": "A quick sketch I did on the train.",
        "creation_meta": {
          "args": { "prompt": "sunrise over the city, sketch style" },
          "method_name": "Image generation",
          "server_name": "Default server"
        }
      },
      {
        "type": "image",
        "source": "top_likes",
        "id": 303,
        "title": "Portrait study",
        "summary": "",
        "created_at": "2025-02-03T18:00:00.000Z",
        "author": "charlie",
        "image_url": "<app-origin>/api/share/v1/ghi789/image",
        "like_count": 42,
        "comment_count": 8,
        "description": null,
        "creation_meta": {
          "args": { "prompt": "portrait, soft lighting" },
          "method_name": "Image generation",
          "server_name": "Default server"
        }
      }
    ],
    "prompt": "A collage mixing the mood of these comments and images"
  }
}
```

---

## Closing the blind spot

Server-to-server traffic is invisible compared to browser DevTools. Parascene reduces that gap in these ways:

1. **This doc** – Single source of truth for the payload shape so provider authors don’t have to guess or sniff traffic.

2. **Preview payload in the UI** – In the Create → Advanced tab, **Preview payload** builds the same request the backend would send (using your current Data Builder options and prompt) and shows it in a modal. No provider is called; you see the exact JSON and can copy it. Use this to confirm what your server will receive or to share a sample with your team.

3. **Optional request logging** – In development, you can enable logging of outgoing provider requests (e.g. via an env flag) so backend logs show the body (with tokens redacted). Helps when debugging live.

4. **Link from app to doc** – Server settings or the Advanced tab can link to this doc (e.g. “What do we send to the server?”) so provider authors know where to look.

5. **Contract tests** – Tests that build the same payload as the app and assert shape (or snapshot) keep the implementation in sync with this reference.

---

## Summary

| Topic | Detail |
|-------|--------|
| **Request format** | Always `POST` with JSON body `{ "method": "<name>", "args": { ... } }`. |
| **advanced_query** | `args`: `items` (array, max 100), optional `prompt`. Respond with JSON: `supported`, `cost`. |
| **advanced_generate** | Same `args` as query. Respond with **image/png** body. |
| **Item count** | Capped at **100** items total, split across the selected Data Builder options. |
| **Item types** | `comment` (recent_comments), `post` (recent_posts), `image` (top_likes / bottom_likes / most_mutated). |
| **Extra args** | Any non–Data-Builder key (e.g. `prompt`) is passed through in `args` as-is. |
| **Creation context** | Each item may include `description` and `creation_meta` (args, method_name, server_name, history, mutate_of_id) for the creation it refers to. |
| **Image access** | Use `image_url` (share URL) to GET the image when you need it; no auth required. |

Implementing against this shape ensures your provider stays in sync with what Parascene sends, even though the calls are server-to-server and not visible in the browser.
