import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth';
import { createLeagueAction } from '@/app/actions';
import LeagueForm from '@/components/LeagueForm';

export default async function NewLeaguePage() {
  const user = await currentUser();
  if (!user) redirect('/login');
  return (
    <>
      <h1>Créer une ligue</h1>
      <p className="subtitle">
        Tu seras le commissaire : c’est toi qui lances le mercato puis chaque journée de championnat.
      </p>
      <div className="card form-narrow">
        <LeagueForm
          action={createLeagueAction}
          fields={[
            { name: 'name', label: 'Nom de la ligue', placeholder: 'Les Reufs du Parquet' },
            { name: 'teamName', label: 'Nom de ton équipe', placeholder: 'Samy City Ballers' },
            { name: 'maxMembers', label: 'Nombre max d’équipes (2 à 10)', type: 'number', defaultValue: '8' },
          ]}
          submitLabel="Créer la ligue"
        />
      </div>
    </>
  );
}
