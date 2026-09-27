# Devpost copy (paste and edit)

## Inspiration
Most people who go into cardiac arrest outside a hospital don't survive, and bystander CPR can double or triple the odds. But most students have never practiced, and the ones who have forget. We wanted first aid practice you'd actually open on a Tuesday night.

## What it does
Truman on Call is a drag-and-drop first aid game set on a college campus. Players see an illustrated emergency and drag the right action onto the right spot: hands on the chest (not the stomach), pinch the soft part of the nose (not the bridge), hand under the tap (not in the freezer). Ten emergencies, including a CPR rhythm game, an opioid overdose scenario based on the 2025 AHA naloxone guidance, stroke (BE FAST), seizures, anaphylaxis with an auto-injector, and Stop the Bleed tourniquets. A CPR Lab measures real compressions on a pillow using a phone accelerometer, a webcam, or a $10 Arduino force sensor. Stars unlock outfits, badges reward streaks, and Coach Pulse, an AI coach, explains every mistake.

## How we built it
Vanilla HTML/CSS/JS with hand-built SVG scenes and Web Audio sound. A Node/Express backend on Vultr connects:
- **Tiger Data**: answers and individual CPR compressions stored in hypertables, with continuous aggregates for live insights (most-believed myths, CPR quality across campus).
- **Snowflake Cortex**: the LLM behind Coach Pulse.
- **Solana**: tamper-proof training certificates written to devnet.
- **ElevenLabs**: Truman's voice.

## Challenges
Keeping the medical content correct: the 2025 AHA update changed choking guidance to alternating back blows and abdominal thrusts, so we rewrote that level mid-hackathon.

## What's next
Skill-decay drills (a 60-second daily scenario), camera- or phone-based compression depth checks, more scenarios (stroke, seizure, allergic reaction), and partnering with campus CPR courses.
