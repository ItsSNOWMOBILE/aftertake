import { useId, useState } from 'react';
import {
  frameCreativeRecipes,
  imageCreativeRecipes,
  videoCreativeRecipes,
} from './creative-recipes';
import './creative-recipes.css';

export default function CreativeRecipePicker({
  kind,
  hasSubject = false,
  disabled = false,
  onLoad,
}: {
  kind: 'image' | 'video' | 'frame';
  hasSubject?: boolean;
  disabled?: boolean;
  onLoad: (id: string) => void;
}) {
  const id = useId();
  const [selected, setSelected] = useState('');
  const recipes = {
    image: imageCreativeRecipes,
    video: videoCreativeRecipes,
    frame: frameCreativeRecipes,
  }[kind];
  const recipe = recipes.find((item) => item.id === selected);
  const needsSubject =
    recipe && 'requiresSubject' in recipe && recipe.requiresSubject && !hasSubject;
  return (
    <div className="creative-recipe-picker">
      <label htmlFor={id}>Start with a recipe</label>
      <div className="creative-recipe-row">
        <select
          id={id}
          value={selected}
          disabled={disabled}
          aria-describedby={`${id}-description`}
          onChange={(event) => setSelected(event.target.value)}
        >
          <option value="">Choose a starter…</option>
          {recipes.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="button"
          disabled={disabled || !recipe || !!needsSubject}
          onClick={() => recipe && onLoad(recipe.id)}
        >
          Load starter
        </button>
      </div>
      <p id={`${id}-description`}>
        {needsSubject
          ? 'Choose a subject reference below to use this starter.'
          : recipe?.description}
        {!recipe &&
          'Load an editable prompt and look. Review the settings, then generate when ready.'}
      </p>
      <small>
        {
          {
            image: 'Keeps your image name, frame and seed.',
            video: 'Keeps your video name, frame, quality and seed.',
            frame: 'Keeps your source, starting frame, subject reference and seed.',
          }[kind]
        }
      </small>
    </div>
  );
}
