import type { Recipe } from './domain';

export default function MotionDirection({ recipe, disabled, onChange }: {
  recipe: Recipe; disabled: boolean; onChange: (transfer: NonNullable<Recipe['transfer']>) => void;
}) {
  const transfer = recipe.transfer || { scope: 'frame' as const };
  return <section className="motion-direction" aria-label="Motion transfer direction">
    <label htmlFor="motion-caption">DRIVING MOTION <span>OPTIONAL</span></label>
    <textarea id="motion-caption" disabled={disabled} value={transfer.motionCaption || ''} maxLength={2000}
      placeholder="A person raises one arm, waves, then lowers it. The camera stays still."
      onChange={event => onChange({ ...transfer, motionCaption: event.target.value })}/>
    <p>Describe the action in the driving video. Your direction above describes the finished character and scene.</p>
    <label htmlFor="motion-scope">WHERE TO APPLY IT</label>
    <select id="motion-scope" disabled={disabled} value={transfer.scope} onChange={event => onChange({ ...transfer, scope: event.target.value as 'frame' | 'cue' })}>
      <option value="frame">Whole frame</option><option value="cue">Painted and timed cue</option>
    </select>
    <p>{transfer.scope === 'frame' ? 'Animate the appearance image for the whole shot. The driving clip supplies timing and source audio.' : 'Blend the generated character and scene into your painted cue. Give the gesture enough room; the source stays outside it.'}</p>
  </section>;
}
