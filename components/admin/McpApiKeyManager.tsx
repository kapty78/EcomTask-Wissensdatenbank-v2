'use client';

import { useState, useEffect } from 'react';
import { getSupabaseClient } from '@/lib/supabase-browser';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Copy, Key, Trash2, Eye, EyeOff, Plus } from 'lucide-react';
import { toast } from 'sonner';

interface ApiKey {
  id: string;
  key_prefix: string;
  name: string;
  description: string | null;
  knowledge_base_id: string;
  knowledge_bases: { id: string; name: string } | null;
  rate_limit_per_minute: number;
  last_used_at: string | null;
  total_requests: number;
  expires_at: string | null;
  is_active: boolean;
  created_at: string;
}

interface KnowledgeBase {
  id: string;
  name: string;
}

export function McpApiKeyManager() {
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBase[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showKeyDialog, setShowKeyDialog] = useState(false);
  const [newKeyData, setNewKeyData] = useState<{
    rawKey: string;
    name: string;
    keyPrefix: string;
  } | null>(null);

  // Form state
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    knowledge_base_id: '',
    rate_limit_per_minute: 60,
  });

  const supabase = getSupabaseClient();

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    try {
      // Load API Keys
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const response = await fetch('/api/mcp/api-keys', {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });

      if (response.ok) {
        const data = await response.json();
        setApiKeys(data.apiKeys || []);
      }

      // Load Knowledge Bases
      const { data: kbData } = await supabase
        .from('knowledge_bases')
        .select('id, name')
        .order('name');

      if (kbData) {
        setKnowledgeBases(kbData);
      }
    } catch (error) {
      console.error('Error loading data:', error);
      toast.error('Fehler beim Laden der Daten');
    } finally {
      setLoading(false);
    }
  }

  async function createApiKey() {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const response = await fetch('/api/mcp/api-keys', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(formData),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to create API key');
      }

      const data = await response.json();
      
      // Show the key to user (ONLY TIME!)
      setNewKeyData({
        rawKey: data.apiKey.rawKey,
        name: data.apiKey.name,
        keyPrefix: data.apiKey.keyPrefix,
      });
      setShowCreateDialog(false);
      setShowKeyDialog(true);

      // Reset form
      setFormData({
        name: '',
        description: '',
        knowledge_base_id: '',
        rate_limit_per_minute: 60,
      });

      // Reload list
      await loadData();

      toast.success('API Key erfolgreich erstellt');
    } catch (error) {
      console.error('Error creating API key:', error);
      toast.error(error instanceof Error ? error.message : 'Fehler beim Erstellen');
    }
  }

  async function toggleApiKey(id: string, isActive: boolean) {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const response = await fetch('/api/mcp/api-keys', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ id, is_active: !isActive }),
      });

      if (!response.ok) throw new Error('Failed to update API key');

      await loadData();
      toast.success(isActive ? 'API Key deaktiviert' : 'API Key aktiviert');
    } catch (error) {
      console.error('Error toggling API key:', error);
      toast.error('Fehler beim Aktualisieren');
    }
  }

  async function deleteApiKey(id: string) {
    if (!confirm('API Key wirklich löschen? Diese Aktion kann nicht rückgängig gemacht werden.'))
      return;

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const response = await fetch(`/api/mcp/api-keys?id=${id}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });

      if (!response.ok) throw new Error('Failed to delete API key');

      await loadData();
      toast.success('API Key gelöscht');
    } catch (error) {
      console.error('Error deleting API key:', error);
      toast.error('Fehler beim Löschen');
    }
  }

  function copyToClipboard(text: string) {
    navigator.clipboard.writeText(text);
    toast.success('In Zwischenablage kopiert');
  }

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>MCP API Keys</CardTitle>
          <CardDescription>Lade...</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>MCP API Keys</CardTitle>
              <CardDescription>
                API Keys für externe Zugriffe (ChatGPT, Cursor, etc.)
              </CardDescription>
            </div>
            <Button onClick={() => setShowCreateDialog(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Neuer API Key
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {apiKeys.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              Noch keine API Keys vorhanden. Erstelle einen für ChatGPT oder andere MCP Clients.
            </div>
          ) : (
            <div className="space-y-4">
              {apiKeys.map((key) => (
                <div
                  key={key.id}
                  className="border rounded-lg p-4 space-y-3"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <Key className="h-4 w-4 text-muted-foreground" />
                        <h3 className="font-semibold">{key.name}</h3>
                        <Badge variant={key.is_active ? 'default' : 'secondary'}>
                          {key.is_active ? 'Aktiv' : 'Inaktiv'}
                        </Badge>
                      </div>
                      {key.description && (
                        <p className="text-sm text-muted-foreground mt-1">
                          {key.description}
                        </p>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => toggleApiKey(key.id, key.is_active)}
                      >
                        {key.is_active ? (
                          <EyeOff className="h-4 w-4" />
                        ) : (
                          <Eye className="h-4 w-4" />
                        )}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => deleteApiKey(key.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <span className="text-muted-foreground">Key Prefix:</span>
                      <div className="flex items-center gap-2 mt-1">
                        <code className="bg-muted px-2 py-1 rounded">
                          {key.key_prefix}...
                        </code>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => copyToClipboard(key.key_prefix)}
                        >
                          <Copy className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Knowledge Base:</span>
                      <p className="mt-1 font-medium">
                        {key.knowledge_bases?.name || key.knowledge_base_id}
                      </p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Rate Limit:</span>
                      <p className="mt-1">{key.rate_limit_per_minute} / Minute</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Anfragen:</span>
                      <p className="mt-1">{key.total_requests || 0} gesamt</p>
                    </div>
                    {key.last_used_at && (
                      <div>
                        <span className="text-muted-foreground">Zuletzt genutzt:</span>
                        <p className="mt-1">
                          {new Date(key.last_used_at).toLocaleString('de-DE')}
                        </p>
                      </div>
                    )}
                    <div>
                      <span className="text-muted-foreground">Erstellt:</span>
                      <p className="mt-1">
                        {new Date(key.created_at).toLocaleString('de-DE')}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Neuen API Key erstellen</DialogTitle>
            <DialogDescription>
              Erstelle einen API Key für externe Zugriffe via MCP Protocol.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <Label htmlFor="name">Name *</Label>
              <Input
                id="name"
                placeholder="z.B. ChatGPT Production"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              />
            </div>

            <div>
              <Label htmlFor="kb">Knowledge Base *</Label>
              <Select
                value={formData.knowledge_base_id}
                onValueChange={(value) =>
                  setFormData({ ...formData, knowledge_base_id: value })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Wähle eine Knowledge Base" />
                </SelectTrigger>
                <SelectContent>
                  {knowledgeBases.map((kb) => (
                    <SelectItem key={kb.id} value={kb.id}>
                      {kb.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="description">Beschreibung</Label>
              <Textarea
                id="description"
                placeholder="Optionale Beschreibung"
                value={formData.description}
                onChange={(e) =>
                  setFormData({ ...formData, description: e.target.value })
                }
              />
            </div>

            <div>
              <Label htmlFor="rate_limit">Rate Limit (pro Minute)</Label>
              <Input
                id="rate_limit"
                type="number"
                min="1"
                value={formData.rate_limit_per_minute}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    rate_limit_per_minute: parseInt(e.target.value) || 60,
                  })
                }
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateDialog(false)}>
              Abbrechen
            </Button>
            <Button
              onClick={createApiKey}
              disabled={!formData.name || !formData.knowledge_base_id}
            >
              API Key erstellen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Show Key Dialog (ONLY TIME!) */}
      <Dialog open={showKeyDialog} onOpenChange={setShowKeyDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>⚠️ API Key erstellt</DialogTitle>
            <DialogDescription>
              Speichere diesen Key jetzt! Er wird nur einmal angezeigt und kann nicht
              wiederhergestellt werden.
            </DialogDescription>
          </DialogHeader>

          {newKeyData && (
            <div className="space-y-4">
              <div>
                <Label>Name</Label>
                <p className="font-medium">{newKeyData.name}</p>
              </div>

              <div>
                <Label>API Key</Label>
                <div className="flex items-center gap-2 mt-2">
                  <code className="flex-1 bg-muted px-3 py-2 rounded font-mono text-sm break-all">
                    {newKeyData.rawKey}
                  </code>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => copyToClipboard(newKeyData.rawKey)}
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              <div className="bg-muted/20 border border-border rounded-lg p-4">
                <p className="text-sm">
                  <strong>Wichtig:</strong> Dieser Key wird nur einmal angezeigt. Speichere
                  ihn an einem sicheren Ort (z.B. in ChatGPT App Settings).
                </p>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button onClick={() => setShowKeyDialog(false)}>
              Ich habe den Key gespeichert
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
