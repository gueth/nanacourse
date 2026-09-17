'use client';

import { useEffect, useState } from 'react';

type Task = { id: string; title: string; description: string };

const DEFAULT_TASKS: Task[] = [
  { id: '1', title: 'Tâche 1', description: 'Explication de la tâche 1' },
  { id: '2', title: 'Tâche 2', description: 'Explication de la tâche 2' },
  { id: '3', title: 'Tâche 3', description: 'Explication de la tâche 3' },
  { id: '4', title: 'Tâche 4', description: 'Explication de la tâche 4' }
];

type TodoCardProps = {
  title?: string;
  tasks?: Task[];
  onProgressChange?: (torn: number, total: number) => void;
};

export function TodoCard({ title = 'votre prochaine mission', tasks = DEFAULT_TASKS, onProgressChange }: TodoCardProps) {
  // ARRACHÉE : la tâche est animée puis disparaît en laissant un espace vide
  const [tearing, setTearing] = useState<Record<string, boolean>>({});
  const [torn, setTorn] = useState<Record<string, boolean>>({});

  useEffect(() => {
    onProgressChange?.(Object.values(torn).filter(Boolean).length, tasks.length);
  }, [torn, tasks.length, onProgressChange]);

  function handleTear(id: string) {
    if (tearing[id] || torn[id]) return;
    setTearing((t) => ({ ...t, [id]: true }));
  }

  return (
    <div className="rounded-md overflow-hidden flex">
      <div className="flex items-center justify-center px-4 py-4 border-r-2 border-dashed border-navy/50 bg-sky">
        <h2 className="title-hand text-navy text-2xl text-center leading-tight [writing-mode:vertical-rl] rotate-180 whitespace-nowrap">
          {title}
        </h2>
      </div>

      <ul className="flex-1">
        {tasks.map((task, i) => (
          <li
            key={task.id}
            onClick={() => handleTear(task.id)}
            onAnimationEnd={() => {
              if (!tearing[task.id]) return;
              setTorn((t) => ({ ...t, [task.id]: true }));
              setTearing((t) => ({ ...t, [task.id]: false }));
            }}
            className={`px-4 py-3 ${i < tasks.length - 1 ? 'border-b-2 border-dashed' : ''} ${
              i < tasks.length - 1 && !torn[task.id] ? 'border-navy/50' : 'border-transparent'
            } ${torn[task.id] ? 'bg-transparent' : 'bg-sky'} ${torn[task.id] ? '' : 'cursor-pointer'} ${
              tearing[task.id] ? 'tear-off-animate' : ''
            }`}
          >
            <p className={`font-type text-navy text-base leading-tight ${torn[task.id] ? 'invisible' : ''}`}>
              {task.title}
            </p>
            <p className={`font-type text-navy/70 text-xs leading-tight ${torn[task.id] ? 'invisible' : ''}`}>
              {task.description}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
