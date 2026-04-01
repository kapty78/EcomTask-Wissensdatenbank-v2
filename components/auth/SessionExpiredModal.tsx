"use client"

import { useState, useEffect } from 'react';
import { getSupabaseClient } from '@/lib/supabase-browser';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { X } from 'lucide-react';

interface SessionExpiredModalProps {
  isOpen: boolean;
  onClose: () => void;
  supabaseClient: any;
}

export default function SessionExpiredModal({ isOpen, onClose, supabaseClient }: SessionExpiredModalProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [company, setCompany] = useState<any>(null);
  const [isVisible, setIsVisible] = useState(false);

  const router = useRouter();

  // Company-Info beim Öffnen des Modals laden und Animation starten
  useEffect(() => {
    if (isOpen) {
      loadCompanyInfo();
      setIsVisible(true);
    } else {
      setIsVisible(false);
    }
  }, [isOpen]);

  const loadCompanyInfo = async () => {
    try {
      // Versuche, gespeicherte Company-Info zu laden
      const savedCompany = localStorage.getItem('company');
      if (savedCompany) {
        setCompany(JSON.parse(savedCompany));
      }
    } catch (error) {
      console.error('Fehler beim Laden der Company-Info:', error);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(null);

    if (!email || !password) {
      setError('Bitte E-Mail und Passwort eingeben');
      setLoading(false);
      return;
    }

    try {
      // Anmeldung mit Supabase
      const { data, error } = await supabaseClient.auth.signInWithPassword({
        email,
        password
      });

      if (error) {
        const errorMessage = `Login fehlgeschlagen: ${error.message}`;
        setError(errorMessage);
      } else if (data.user) {
        setSuccess('Erfolgreich angemeldet');
        setTimeout(() => {
          onClose();
          window.location.reload(); // Seite neu laden um Session zu aktualisieren
        }, 1000);
      }
    } catch (error: any) {
      setError(error.message || 'Ein Fehler ist aufgetreten');
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    onClose();
    // Optional: Zur Login-Seite weiterleiten
    router.push('/login');
  };

  if (!isOpen) return null;

  return (
    <div className={`fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm transition-opacity duration-300 ${isVisible ? 'opacity-100' : 'opacity-0'}`}>
      <div className={`relative w-full max-w-md mx-4 bg-[#1e1e1e] rounded-2xl border border-[#333333] shadow-2xl transform transition-all duration-300 ${isVisible ? 'scale-100 opacity-100 translate-y-0' : 'scale-95 opacity-0 translate-y-4'}`}>
        {/* Header mit Logo und Schließen-Button */}
        <div className="flex items-center justify-between p-6 border-b border-[#333333]">
          <div className="flex items-center gap-3">
            <Image
              src="/EcomTask.svg"
              alt="EcomTask Logo"
              width={168}
              height={43}
              priority
            />
          </div>
          <button
            onClick={handleClose}
            className="p-2 text-gray-400 hover:text-white transition-colors rounded-lg hover:bg-[#2a2a2a]"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6">
          <div className="text-center mb-6">
            <h2 className="text-2xl font-semibold text-white mb-2">
              Session abgelaufen
            </h2>
            <p className="text-gray-400 text-sm">
              Ihre Anmeldung ist abgelaufen. Bitte melden Sie sich erneut an, um fortzufahren.
            </p>
            {company && (
              <p className="text-gray-300 text-xs mt-2">
                {company.name}
              </p>
            )}
          </div>

          <form onSubmit={handleLogin} className="space-y-4">
            <div className="relative">
              <input
                id="email"
                type="email"
                placeholder="E-Mail-Adresse"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="block w-full h-12 rounded-[12px] border bg-[#2a2a2a] px-4 text-[14px] text-white placeholder:text-gray-400 focus:outline-none focus:ring-0 border-[#3a3a3a] focus:border-[#777777]"
                required
              />
            </div>

            <div className="relative">
              <input
                id="password"
                type="password"
                placeholder="Passwort"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="block w-full h-12 rounded-[12px] border bg-[#2a2a2a] px-4 text-[14px] text-white placeholder:text-gray-400 focus:outline-none focus:ring-0 border-[#3a3a3a] focus:border-[#777777]"
                required
              />
            </div>

            {error && (
              <div className="mt-1">
                <p className="text-xs text-muted-foreground text-center">{error}</p>
              </div>
            )}

            {success && (
              <div className="mt-1">
                <p className="text-xs text-muted-foreground text-center">{success}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full h-12 rounded-full bg-white px-4 font-semibold text-[#1e1e1e] transition-colors hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-[#1e1e1e] disabled:opacity-50"
            >
              {loading ? 'Anmeldung läuft...' : 'Erneut anmelden'}
            </button>
          </form>

          <div className="mt-4 text-center">
            <button
              onClick={() => {
                onClose();
                router.push('/login');
              }}
              className="text-sm text-gray-400 hover:text-white underline"
            >
              Zur Anmeldung wechseln
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-[#333333] bg-[#1a1a1a] rounded-b-2xl">
          <div className="flex justify-center items-center">
            <p className="text-xs text-gray-500">
              powered by <span className="text-white font-medium">EcomTask</span>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
