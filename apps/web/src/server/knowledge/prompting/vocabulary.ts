/**
 * Closed vocabularies for shot construction.
 *
 * These exist because a model asked to "write a good video prompt" writes an
 * adjective salad — "cinematic, beautiful, high quality, 8k" — which produces
 * exactly the plastic look that gets a UGC account dismissed in half a second.
 *
 * Every term below is one a director would actually say on set. The agent picks
 * from these enums; it does not compose prose. Specificity is enforced by the
 * type system rather than requested in a prompt.
 */

/* ── Framing ─────────────────────────────────────────────────────────────── */

export const SHOT_SIZES = {
  ECU: "extreme close-up, filling the frame with the eyes and mouth only",
  CU: "close-up, head and a little shoulder",
  MCU: "medium close-up, head to mid-chest",
  MS: "medium shot, head to waist",
  MWS: "medium wide, full torso and some room behind",
  WS: "wide shot, the whole body inside the space",
  INSERT: "tight insert on hands and the object they hold",
  OTS: "over-the-shoulder, the near shoulder soft in the foreground",
} as const;
export type ShotSize = keyof typeof SHOT_SIZES;

export const ANGLES = {
  SELFIE_HIGH: "held slightly above eye level and angled down, the way people hold their own phone",
  EYE: "at eye level, straight on",
  LOW: "below eye level, tilted up",
  OVERHEAD: "directly overhead, looking straight down",
  OVER_SHOULDER: "from just behind and beside the subject's shoulder",
  HIP: "held low at hip height, angled up, as if filming without looking",
} as const;
export type Angle = keyof typeof ANGLES;

export const CAMERA_MOTION = {
  HANDHELD_STATIC: "handheld, essentially still, with the small constant drift of a real hand",
  HANDHELD_DRIFT: "handheld, drifting a few centimetres and correcting, never on a tripod",
  ARM_EXTEND: "held at arm's length and slowly brought closer to the face",
  WALK: "walking, the frame bouncing gently with each step",
  WHIP: "a fast whip to the side, motion blur smearing the frame",
  PUSH_IN: "pushed in toward the subject by hand, not zoomed",
  FOLLOW: "following the subject from behind, the frame lagging half a beat",
  LOCKED_PROP: "propped against something and left there, motionless, slightly crooked",
  TABLE_TILT: "lying on a table, tilted, catching the scene from a corner",
} as const;
export type CameraMotion = keyof typeof CAMERA_MOTION;

/* ── Light ───────────────────────────────────────────────────────────────── */

/**
 * Every entry names an in-world source. "Dramatic lighting" tells a model
 * nothing; "the blue of a television, alone, in an unlit room" tells it where
 * the photons come from, which is the only thing it can actually render.
 */
export const LIGHTING = {
  WINDOW_SIDE: "one window off to the side, bright on that cheek, the other side falling into shadow",
  WINDOW_BACK: "a window behind the subject blowing out to white, the face a little underexposed",
  KITCHEN_OVERHEAD: "a single overhead kitchen fixture, hard shadows under the eyes",
  LAMP_WARM: "a warm bedside lamp just out of frame, everything else dim",
  SCREEN_GLOW: "lit only by a phone or laptop screen, cold and shifting on the face",
  TV_BLUE: "the blue flicker of a television, alone, in an otherwise unlit room",
  BATHROOM_MIRROR: "flat bathroom vanity light, unflattering, slightly green",
  CAR_DAY: "daylight through a car windscreen, patchy as the car moves",
  STREET_NIGHT: "sodium street lights and passing headlights, uneven and orange",
  OFFICE_FLUORESCENT: "office fluorescent tubes, flat and slightly green",
  GOLDEN_WINDOW: "late afternoon sun coming in low through a window, long and orange across the room",
  RING_LIGHT: "an obvious ring light, a visible circle catchlight in each eye",
} as const;
export type Lighting = keyof typeof LIGHTING;

/* ── Texture ─────────────────────────────────────────────────────────────── */

/**
 * The look. Almost all of these push *away* from production polish — that is the
 * entire point. `CLEAN_DIGITAL` and `FILM_DRAMA` exist for the rare formats that
 * deliberately want a produced look, and are the exception.
 */
export const TEXTURE = {
  IPHONE_FRONT:
    "front-facing phone camera: slightly soft, mild lens distortion at the edges, visible sensor noise in the shadows, no colour grade",
  IPHONE_BACK:
    "rear phone camera: sharper, a touch over-sharpened, highlights clipping, heavy-handed automatic HDR",
  NIGHT_MODE:
    "phone night mode: smeared shadows, colour noise, slight ghosting where anything moved",
  SCREEN_RECORD:
    "a screen recording of a video playing, faint moiré, slightly wrong colours, the UI edges visible",
  OLD_PHONE:
    "an older phone: lower resolution, mushy compression, blown highlights",
  SECURITY_CAM:
    "fixed security camera: wide distorted lens, low frame rate, timestamp burnt into the corner, desaturated",
  VIDEO_CALL:
    "a video call: compression artefacts, occasional frozen frame, framing nobody adjusted",
  FILM_DRAMA:
    "shot properly on a cinema camera: shallow depth of field, controlled contrast, deliberate colour",
  CLEAN_DIGITAL: "clean modern digital capture, neutral colour, no obvious artefacts",
} as const;
export type Texture = keyof typeof TEXTURE;

/* ── Performance ─────────────────────────────────────────────────────────── */

/**
 * Direction for the face. Written the way you would tell an actor, because that
 * is what produces a readable performance instead of a mannequin holding an
 * expression.
 */
export const PERFORMANCE = {
  MID_SENTENCE:
    "caught mid-sentence, already talking when the clip starts, not waiting for a cue",
  STUNNED:
    "stops mid-word, eyebrows up, a beat of genuine disbelief before recovering",
  DEADPAN: "completely flat, holding the camera's gaze, letting the silence do the work",
  SUPPRESSED_LAUGH: "trying not to laugh and failing at the corners of the mouth",
  EXHAUSTED: "worn out, blinking slowly, speaking quietly because it is late",
  ANNOYED: "irritated, jaw set, exhaling through the nose",
  CONSPIRATORIAL: "leaning in, dropping the voice as if the room might overhear",
  BUILDING: "starting flat and gaining energy through the shot, ending noticeably louder",
  DEFLATING: "starting animated and losing steam as the reality lands",
  ABSORBED: "not addressing the camera at all, absorbed in the task",
  RELIEVED: "the tension going out of the shoulders, a small involuntary laugh",
  DISMISSIVE: "shrugging it off, already looking away",
} as const;
export type Performance = keyof typeof PERFORMANCE;

/* ── Negatives ───────────────────────────────────────────────────────────── */

/**
 * What to exclude. As load-bearing as the positive prompt: a model's default
 * mode is the commercial, and the commercial is what must be suppressed.
 */
export const NEGATIVE_SETS = {
  ANTI_COMMERCIAL: [
    "studio lighting",
    "professional photography",
    "advertisement",
    "commercial",
    "product hero shot",
    "stock footage",
    "perfectly centred framing",
    "brand colours",
    "graphic overlays",
    "logo",
  ],
  ANTI_PLASTIC: [
    "airbrushed skin",
    "flawless complexion",
    "beauty filter",
    "symmetrical face",
    "model",
    "fashion photography",
    "waxy skin",
    "uncanny smoothness",
  ],
  ANTI_CINEMA: [
    "gimbal",
    "crane shot",
    "drone",
    "lens flare",
    "anamorphic",
    "teal and orange grade",
    "slow motion",
    "colour grading",
  ],
  ANTI_STAGED: [
    "posed",
    "staged",
    "looking at the camera and waiting",
    "empty tidy showroom",
    "designer interior",
    "props arranged neatly",
  ],
  ANTI_TEXT: ["subtitles", "captions", "watermark", "text overlay", "burnt-in text", "letterboxing"],
} as const;
export type NegativeSet = keyof typeof NEGATIVE_SETS;

/* ── Ambience ────────────────────────────────────────────────────────────── */

/**
 * Omni generates audio with the picture, so the soundscape is part of the shot.
 * Room tone is what separates a clip that feels filmed from one that feels
 * rendered — silence is the giveaway.
 */
export const AMBIENCE = {
  ROOM_QUIET: "quiet room tone, a distant fridge hum, nothing else",
  STREET: "street noise, traffic, a car passing close",
  CAFE: "café murmur, cups, an espresso machine somewhere behind",
  OFFICE: "open-plan office: keyboards, a phone ringing two desks away",
  KITCHEN: "kitchen sounds, a tap running, something set down on a counter",
  TV_BACKGROUND: "a television playing indistinctly in the next room",
  CAR: "inside a car: engine, indicator ticking, road noise",
  NIGHT: "late-night silence with a faint electrical hum",
  NONE: "no ambient sound at all",
} as const;
export type Ambience = keyof typeof AMBIENCE;
