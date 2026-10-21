import { useId, useState } from 'react';
import { Clapperboard, ImageIcon, Wand2 } from 'lucide-react';
import {
  frameCreativeRecipes,
  imageCreativeRecipes,
  videoCreativeRecipes,
} from './creative-recipes';
import { cinemaOptions } from './cinema';
import { starterPreviewIds } from './starter-previews';
import './creative-recipes.css';

type Kind = 'image' | 'video' | 'frame';
const icons = { image: ImageIcon, video: Clapperboard, frame: Wand2 };
const capital = (text: string) => text[0].toUpperCase() + text.slice(1);

/** A short factual line under each card: what the starter sets. */
function facts(kind: Kind, id: string) {
  if (kind === 'video') {
    const recipe = videoCreativeRecipes.find((item) => item.id === id)!;
    const movement = cinemaOptions.movement.find(
      ([value]) => value === recipe.settings.cinema.movement,
    )?.[1];
    return `${movement} · ${recipe.settings.seconds} s${recipe.settings.sound ? ' · sound' : ''}`;
  }
  if (kind === 'image') {
    const recipe = imageCreativeRecipes.find((item) => item.id === id)!;
    const direction = recipe.settings.direction;
    return [
      capital(recipe.settings.style),
      direction && direction.shot !== 'none' && direction.shot,
    ]
      .filter(Boolean)
      .join(' · ');
  }
  const recipe = frameCreativeRecipes.find((item) => item.id === id)!;
  return recipe.requiresSubject ? 'Uses your subject image' : 'Keeps your frame';
}

export default function CreativeRecipePicker({
  kind,
  hasSubject = false,
  disabled = false,
  onLoad,
}: {
  kind: Kind;
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
  const Icon = icons[kind];
  const preview = (starter: string, extension: 'mp4' | 'jpg') =>
    `${import.meta.env.BASE_URL}starters/${starter}.${extension}`;
  return (
    <div className="creative-recipe-picker">
      <span className="creative-recipe-heading" id={`${id}-heading`}>
        Start with a recipe
      </span>
      <div className="creative-recipe-grid" role="group" aria-labelledby={`${id}-heading`}>
        {recipes.map((item, index) => (
          <button
            type="button"
            key={item.id}
            className="creative-recipe-card"
            aria-pressed={item.id === selected}
            disabled={disabled}
            onClick={() => setSelected(item.id === selected ? '' : item.id)}
          >
            {starterPreviewIds.has(item.id) ? (
              <video
                aria-hidden="true"
                src={preview(item.id, 'mp4')}
                poster={preview(item.id, 'jpg')}
                muted
                loop
                playsInline
                autoPlay
                preload="metadata"
              />
            ) : (
              <span className={`creative-recipe-tile tone-${index % 4}`} aria-hidden="true">
                <Icon size={22} />
              </span>
            )}
            <strong>{item.label}</strong>
            <small>{facts(kind, item.id)}</small>
          </button>
        ))}
      </div>
      <p id={`${id}-description`} aria-live="polite">
        {needsSubject
          ? 'Choose a subject reference below to use this starter.'
          : recipe?.description ||
            'Pick a starter to load an editable prompt and look. Review it, then generate.'}
      </p>
      <button
        type="button"
        className="button creative-recipe-use"
        disabled={disabled || !recipe || !!needsSubject}
        aria-describedby={`${id}-description`}
        onClick={() => recipe && onLoad(recipe.id)}
      >
        Use this starter
      </button>
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
