import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { useCommunicationSettings } from "@/hooks/useCommunicationSettings";
import { Mail, Phone, MessageCircle, Loader2, Save } from "lucide-react";

interface Props {
  institutionId: string;
}

export function CommunicationSettings({ institutionId }: Props) {
  const { settings, isLoading, upsertSettings } = useCommunicationSettings(institutionId);

  const [form, setForm] = useState({
    email_enabled: false,
    email_provider: "",
    email_api_key: "",
    email_from_address: "",
    sms_enabled: false,
    sms_provider: "",
    sms_api_key: "",
    sms_sender_id: "",
    whatsapp_enabled: false,
    whatsapp_provider: "",
    whatsapp_api_key: "",
    whatsapp_phone_number: "",
    bulk_messaging_enabled: false,
  });

  useEffect(() => {
    if (settings) {
      setForm({
        email_enabled: settings.email_enabled,
        email_provider: settings.email_provider || "",
        email_api_key: settings.email_api_key || "",
        email_from_address: settings.email_from_address || "",
        sms_enabled: settings.sms_enabled,
        sms_provider: settings.sms_provider || "",
        sms_api_key: settings.sms_api_key || "",
        sms_sender_id: settings.sms_sender_id || "",
        whatsapp_enabled: settings.whatsapp_enabled,
        whatsapp_provider: settings.whatsapp_provider || "",
        whatsapp_api_key: settings.whatsapp_api_key || "",
        whatsapp_phone_number: settings.whatsapp_phone_number || "",
        bulk_messaging_enabled: settings.bulk_messaging_enabled,
      });
    }
  }, [settings]);

  const handleSave = () => {
    upsertSettings.mutate({ institution_id: institutionId, ...form });
  };

  if (isLoading) {
    return <div className="flex items-center justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="space-y-6">
      {/* Email Configuration */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-blue-500/10 flex items-center justify-center">
                <Mail className="h-5 w-5 text-blue-500" />
              </div>
              <div>
                <CardTitle className="text-lg">Email Notifications</CardTitle>
                <CardDescription>Configure email delivery for your institution</CardDescription>
              </div>
            </div>
            <Switch checked={form.email_enabled} onCheckedChange={(v) => setForm(f => ({ ...f, email_enabled: v }))} />
          </div>
        </CardHeader>
        {form.email_enabled && (
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Provider</Label>
                <Select value={form.email_provider} onValueChange={(v) => setForm(f => ({ ...f, email_provider: v }))}>
                  <SelectTrigger><SelectValue placeholder="Select provider" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="resend">Resend</SelectItem>
                    <SelectItem value="sendgrid">SendGrid</SelectItem>
                    <SelectItem value="smtp">Custom SMTP</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>From Address</Label>
                <Input value={form.email_from_address} onChange={(e) => setForm(f => ({ ...f, email_from_address: e.target.value }))} placeholder="noreply@school.com" />
              </div>
            </div>
            <div className="space-y-2">
              <Label>API Key</Label>
              <Input type="password" value={form.email_api_key} onChange={(e) => setForm(f => ({ ...f, email_api_key: e.target.value }))} placeholder="Enter your API key" />
            </div>
          </CardContent>
        )}
      </Card>

      {/* SMS Configuration */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-green-500/10 flex items-center justify-center">
                <Phone className="h-5 w-5 text-green-500" />
              </div>
              <div>
                <CardTitle className="text-lg">SMS Notifications</CardTitle>
                <CardDescription>Configure SMS delivery via telecom providers</CardDescription>
              </div>
            </div>
            <Switch checked={form.sms_enabled} onCheckedChange={(v) => setForm(f => ({ ...f, sms_enabled: v }))} />
          </div>
        </CardHeader>
        {form.sms_enabled && (
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Provider</Label>
                <Select value={form.sms_provider} onValueChange={(v) => setForm(f => ({ ...f, sms_provider: v }))}>
                  <SelectTrigger><SelectValue placeholder="Select provider" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="twilio">Twilio</SelectItem>
                    <SelectItem value="msg91">MSG91</SelectItem>
                    <SelectItem value="textlocal">TextLocal</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Sender ID</Label>
                <Input value={form.sms_sender_id} onChange={(e) => setForm(f => ({ ...f, sms_sender_id: e.target.value }))} placeholder="SCHOOL" />
              </div>
            </div>
            <div className="space-y-2">
              <Label>API Key</Label>
              <Input type="password" value={form.sms_api_key} onChange={(e) => setForm(f => ({ ...f, sms_api_key: e.target.value }))} placeholder="Enter your API key" />
            </div>
          </CardContent>
        )}
      </Card>

      {/* WhatsApp Configuration */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                <MessageCircle className="h-5 w-5 text-emerald-500" />
              </div>
              <div>
                <CardTitle className="text-lg">WhatsApp Business API</CardTitle>
                <CardDescription>Send messages via WhatsApp Business</CardDescription>
              </div>
            </div>
            <Switch checked={form.whatsapp_enabled} onCheckedChange={(v) => setForm(f => ({ ...f, whatsapp_enabled: v }))} />
          </div>
        </CardHeader>
        {form.whatsapp_enabled && (
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Provider</Label>
                <Select value={form.whatsapp_provider} onValueChange={(v) => setForm(f => ({ ...f, whatsapp_provider: v }))}>
                  <SelectTrigger><SelectValue placeholder="Select provider" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="twilio">Twilio</SelectItem>
                    <SelectItem value="wati">WATI</SelectItem>
                    <SelectItem value="gupshup">Gupshup</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Phone Number</Label>
                <Input value={form.whatsapp_phone_number} onChange={(e) => setForm(f => ({ ...f, whatsapp_phone_number: e.target.value }))} placeholder="+91XXXXXXXXXX" />
              </div>
            </div>
            <div className="space-y-2">
              <Label>API Key</Label>
              <Input type="password" value={form.whatsapp_api_key} onChange={(e) => setForm(f => ({ ...f, whatsapp_api_key: e.target.value }))} placeholder="Enter your API key" />
            </div>
          </CardContent>
        )}
      </Card>

      {/* Bulk Messaging */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg">Bulk Messaging</CardTitle>
              <CardDescription>Enable bulk communication to all students/parents</CardDescription>
            </div>
            <Switch checked={form.bulk_messaging_enabled} onCheckedChange={(v) => setForm(f => ({ ...f, bulk_messaging_enabled: v }))} />
          </div>
        </CardHeader>
      </Card>

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={upsertSettings.isPending} className="min-w-[140px]">
          {upsertSettings.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
          Save Settings
        </Button>
      </div>
    </div>
  );
}
