import { ArcNav } from '@/components/ArcNav';
import { DoodleNav } from '@/components/DoodleNav';
import { MissionRow } from '@/components/MissionRow';
import { ShoppingCart, Wallet, Shirt, Settings } from "lucide-react";

export default function Home() {
  return (
     <div className="relative bg-white">
        {/* FOND ECRAN */}
         <div
            className="min-h-screen bg-no-repeat rounded-b-3xl"
        >
        </div>

        {/* BARE DE NAVIGATION CIRCULAIRE */}
          <ArcNav
            items={[
              { label: "Parametre", href: "/parametre", icon: <Settings size={20} /> },
              { label: "Dressing", href: "/dressing", icon: <Shirt size={20} /> },
              { label: "Banque", href: "/banque", icon: <Wallet size={20} />},
              { label: "Course", href: "/course", icon: <ShoppingCart size={20} />},

            ]}
          />

        <div className="absolute top-[40%] left-1/2 -translate-x-1/2">
          {/* BARE DE NAVIGATION HORIZONTALE */}
          <div>
            <DoodleNav />
          </div>
      
          {/* MOT D'ENCOURAGEMENT */}
          <p className="mb-8 opacity-90 text-center font-hand text-xl">Mot d&apos;encouregement de la semaine pour se donner du courage.</p>

          {/* CARD MISSION */}
          <MissionRow />
        </div>
    </div>
  );
}
