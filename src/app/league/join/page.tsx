import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth';
import { joinLeagueAction } from '@/app/actions';
import LeagueForm from '@/components/LeagueForm';

export default async function JoinLeaguePage() {
  const user = await currentUser();
  if (!user) redirect('/login');
  return (
    <>
      <h1>Rejoindre une ligue</h1>
      <p className="subtitle">Demande le code d’invitation à 6 caractères au commissaire de la ligue.</p>
      <div className="card form-narrow">
        <LeagueForm
          action={joinLeagueAction}
          fields={[
            { name: 'code', label: 'Code d’invitation', placeholder: 'ABC123' },
            { name: 'teamName', label: 'Nom de ton équipe', placeholder: 'Les Dunkers de la Défense' },
          ]}
          submitLabel="Rejoindre"
        />
      </div>
    </>
  );
}
