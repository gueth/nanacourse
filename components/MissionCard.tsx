type MissionCardProps = {
  title?: string;
  tasks?: string[];
};

export function MissionCard({
  title = "votre prochaine mission",
  tasks = ["Tâche 1", "Tâche 2", "Tâche 3", "Tâche 4", "Tâche 5", "Tâche 6"],
}: MissionCardProps) {
  return (
    <div className="bg-navy rounded-lg p-3 shadow-lg">
      <div className="relative bg-sky rounded-md px-6 pt-6 pb-0 overflow-hidden">
        <h2 className="title-hand text-navy text-3xl sm:text-4xl text-center leading-tight pt-2 pb-6">
          {title}
        </h2>

        <div className="flex border-t-2 border-dashed border-navy/50">
          {tasks.map((task, i) => (
            <div
              key={task}
              className={`flex-1 flex items-center justify-center py-4 ${
                i > 0 ? "border-l-2 border-dashed border-navy/50" : ""
              }`}
            >
              <span className="[writing-mode:vertical-rl] rotate-180 font-type text-[11px] font-bold tracking-widest text-navy uppercase whitespace-nowrap">
                {task}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
