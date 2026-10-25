import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useState, useEffect } from "react";
import { useToast } from "@/hooks/use-toast";
import { useUserRole } from "@/hooks/useUserRole";
import { GoogleAccountCard } from "@/components/ptm/GoogleAccountCard";
import { supabase } from "@/integrations/supabase/client";
import { invokeAdminOperation } from "@/lib/invokeEdgeFunction";
import { toastError } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { getPushPermission, isNativePlatform } from "@/lib/native";
import { disablePushOnThisDevice, enablePushOnThisDevice, savedPushToken } from "@/lib/pushDevices";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { 
  Bell, 
  Moon, 
  Shield, 
  Loader2, 
  Key, 
  Brain, 
  Building2,
  Eye,
  EyeOff,
  Save,
  Sun
} from "lucide-react";
import { DocumentShowcaseTab } from "@/components/settings/DocumentShowcaseTab";
import PRDDocument from "@/components/prd/PRDDocument";
import SystemArchitectureDocument from "@/components/settings/SystemArchitectureDocument";
import SystemMapsDocument from "@/components/settings/SystemMapsDocument";
import ExpansionPlanDocument from "@/components/settings/ExpansionPlanDocument";
import ERPRoadmapDocument from "@/components/settings/ERPRoadmapDocument";
import BuilderGuideDocument from "@/components/settings/BuilderGuideDocument";
import CommandCenterDocument from "@/components/settings/CommandCenterDocument";

const passwordSchema = z.object({
  newPassword: z.string().min(8, "Password must be at least 8 characters"),
  confirmPassword: z.string().min(1, "Please confirm your password"),
}).refine((data) => data.newPassword === data.confirmPassword, {
  message: "Passwords don't match",
  path: ["confirmPassword"],
});

export default function SettingsPage() {
  const { data: userRole } = useUserRole();
  const isSuperAdmin = userRole?.isSuperAdmin;
  const { toast } = useToast();
  const [tab, setTab] = useState("general");
  const [isSaving, setIsSaving] = useState(false);

  // Every General toggle saves as it changes; this confirms the page state.
  // It sits in the tab row, beside "General", so a phone reader does not have
  // to scroll past every card to find it (2026-09-18).
  const handleSave = async () => {
    setIsSaving(true);
    await new Promise(resolve => setTimeout(resolve, 500));
    toast({
      title: "Settings saved",
      description: "Your preferences have been updated.",
    });
    setIsSaving(false);
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-muted-foreground">Manage your application preferences</p>
      </div>

      <Tabs value={tab} onValueChange={setTab} className="space-y-6">
        <div className="flex items-start justify-between gap-3">
          {/* A school admin has one tab; a strip with a single "General" pill
              is noise, so only SALCI admins see the tab list. */}
          <TabsList className={cn("flex-wrap h-auto gap-1", !isSuperAdmin && "hidden")}>
            <TabsTrigger value="general">General</TabsTrigger>
            {isSuperAdmin && <TabsTrigger value="api-keys">API Keys</TabsTrigger>}
            {isSuperAdmin && <TabsTrigger value="ai-quotas">AI Quotas</TabsTrigger>}
            {isSuperAdmin && <TabsTrigger value="prd">PRD</TabsTrigger>}
            {isSuperAdmin && <TabsTrigger value="architecture">Architecture</TabsTrigger>}
            {isSuperAdmin && <TabsTrigger value="system-maps">System Maps</TabsTrigger>}
            {isSuperAdmin && <TabsTrigger value="expansion">Expansion Plan</TabsTrigger>}
            {isSuperAdmin && <TabsTrigger value="erp-roadmap">ERP Roadmap</TabsTrigger>}
            {isSuperAdmin && <TabsTrigger value="builder-guide">Builder Guide</TabsTrigger>}
            {isSuperAdmin && <TabsTrigger value="command-center">Command Center</TabsTrigger>}
          </TabsList>
          {tab === "general" && (
            // h-10 matches the TabsList frame so the two sit on one baseline.
            <Button onClick={handleSave} disabled={isSaving} className="ml-auto h-10 shrink-0">
              {isSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Save Settings
            </Button>
          )}
        </div>

        <TabsContent value="general">
          <GeneralSettings />
        </TabsContent>

        {isSuperAdmin && (
          <TabsContent value="api-keys">
            <APIKeySettings />
          </TabsContent>
        )}

        {isSuperAdmin && (
          <TabsContent value="ai-quotas">
            <AIQuotaSettings />
          </TabsContent>
        )}

        {isSuperAdmin && (
          <TabsContent value="prd">
            <DocumentShowcaseTab
              title="Product Requirements Document"
              description="Comprehensive PRD covering all platform specifications"
              filename="SALCI_PRD_v2.5"
              DocumentComponent={PRDDocument}
            />
          </TabsContent>
        )}

        {isSuperAdmin && (
          <TabsContent value="architecture">
            <DocumentShowcaseTab
              title="System Architecture"
              description="Technology stack, infrastructure, and data flow documentation"
              filename="SALCI_System_Architecture"
              DocumentComponent={SystemArchitectureDocument}
            />
          </TabsContent>
        )}

        {isSuperAdmin && (
          <TabsContent value="system-maps">
            <DocumentShowcaseTab
              title="System Maps"
              description="Route maps, component hierarchy, database schemas, and feature dependencies"
              filename="SALCI_System_Maps"
              DocumentComponent={SystemMapsDocument}
            />
          </TabsContent>
        )}

        {isSuperAdmin && (
          <TabsContent value="expansion">
            <DocumentShowcaseTab
              title="Expansion Plan"
              description="Features built vs. planned, scaling strategy, and development roadmap"
              filename="SALCI_Expansion_Plan"
              DocumentComponent={ExpansionPlanDocument}
            />
          </TabsContent>
        )}

        {isSuperAdmin && (
          <TabsContent value="erp-roadmap">
            <DocumentShowcaseTab
              title="ERP Roadmap"
              description="Comprehensive module mapping, build status, and development priority roadmap"
              filename="SALCI_ERP_Roadmap"
              DocumentComponent={ERPRoadmapDocument}
            />
          </TabsContent>
        )}

        {isSuperAdmin && (
          <TabsContent value="builder-guide">
            <DocumentShowcaseTab
              title="Builder Guide"
              description="Step-by-step guide for building unbuilt SALCI ERP modules"
              filename="SALCI_Builder_Guide"
              DocumentComponent={BuilderGuideDocument}
            />
          </TabsContent>
        )}

        {isSuperAdmin && (
          <TabsContent value="command-center">
            <DocumentShowcaseTab
              title="Command Center Guide"
              description="Admin operations hub: alerts, KPIs, actions, and PDF report reference"
              filename="SALCI_Command_Center_Guide"
              DocumentComponent={CommandCenterDocument}
            />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY;

function GeneralSettings() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [pushStatus, setPushStatus] = useState<"subscribed" | "unsubscribed" | "denied" | "unsupported" | "loading">("loading");
  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false);
  const [passwordForm, setPasswordForm] = useState({
    newPassword: "",
    confirmPassword: "",
  });
  const [passwordErrors, setPasswordErrors] = useState<Record<string, string>>({});
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  // Detect push subscription status on mount
  useEffect(() => {
    const detectPushStatus = async () => {
      // Native app: the phone's permission plus whether this device has a
      // token on record. The Web Push branch below never runs there (a
      // WebView has no usable PushManager).
      if (isNativePlatform()) {
        const permission = await getPushPermission();
        if (permission === "unsupported") setPushStatus("unsupported");
        else if (permission === "denied") setPushStatus("denied");
        else setPushStatus(permission === "granted" && savedPushToken() ? "subscribed" : "unsubscribed");
        return;
      }
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
        setPushStatus("unsupported");
        return;
      }
      if (typeof Notification === "undefined") {
        setPushStatus("unsupported");
        return;
      }
      if (Notification.permission === "denied") {
        setPushStatus("denied");
        return;
      }
      if (Notification.permission === "granted") {
        try {
          const registration = await navigator.serviceWorker.getRegistration("/sw.js");
          if (!registration) {
            setPushStatus("unsubscribed");
            return;
          }
          const pm = registration.pushManager;
          const subscription = await pm.getSubscription();
          if (!subscription) {
            setPushStatus("unsubscribed");
            return;
          }

          // Drift detection + auto-heal: send-web-push deletes dead FCM rows on
          // 410/404, so the server can end up in a state where local getSubscription()
          // still returns an object (Chrome caches it) but the DB row is gone. If
          // that happens, unsubscribe the stale local sub and mint a fresh one so
          // the next push actually delivers. No-op when DB and local agree.
          try {
            const { data: { user } } = await supabase.auth.getUser();
            if (user && VAPID_PUBLIC_KEY) {
              const { data: dbRows } = await supabase
                .from("push_subscriptions")
                .select("endpoint")
                .eq("user_id", user.id);

              const localEndpoint = subscription.endpoint;
              const inDb = dbRows?.some((r) => r.endpoint === localEndpoint);

              if (!inDb) {
                // Zombie: local sub exists but DB doesn't recognize it. Rotate.
                await subscription.unsubscribe().catch(() => {});
                const fresh = await pm.subscribe({
                  userVisibleOnly: true,
                  applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
                });
                const freshJson = fresh.toJSON();
                await supabase.from("push_subscriptions").upsert(
                  {
                    user_id: user.id,
                    endpoint: freshJson.endpoint!,
                    p256dh: freshJson.keys!.p256dh,
                    auth_key: freshJson.keys!.auth,
                  },
                  { onConflict: "user_id,endpoint" }
                );
              }
            }
          } catch (healErr) {
            console.warn("[push] drift self-heal failed:", healErr);
            // Don't block the UI — current sub may still work for some notifications.
          }

          setPushStatus("subscribed");
        } catch {
          setPushStatus("unsubscribed");
        }
      } else {
        setPushStatus("unsubscribed");
      }
    };
    detectPushStatus();
  }, []);

  // Get current theme from document
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    if (typeof window !== "undefined") {
      return document.documentElement.classList.contains("dark") ? "dark" : "light";
    }
    return "light";
  });

  // Fetch user preferences
  const { data: preferences, isLoading: prefsLoading } = useQuery({
    queryKey: ["user-preferences"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;

      const { data, error } = await supabase
        .from("user_preferences")
        .select("*")
        .eq("user_id", user.id)
        .single();
      
      if (error && error.code !== "PGRST116") throw error;
      return data;
    },
  });

  // Update preferences mutation
  const updatePreferences = useMutation({
    mutationFn: async (updates: {
      email_notifications?: boolean;
      push_notifications?: boolean;
      sound_notifications?: boolean;
      theme?: string;
    }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { data, error } = await supabase
        .from("user_preferences")
        .upsert({
          user_id: user.id,
          ...updates,
        }, { onConflict: "user_id" })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["user-preferences"] });
    },
    onError: (error: Error) => {
      toast({ 
        title: "Failed to save preference", 
        description: error.message, 
        variant: "destructive" 
      });
    },
  });

  // Sync local state from preferences (display only, no DOM manipulation)
  useEffect(() => {
    if (preferences?.theme) {
      setTheme(preferences.theme as "light" | "dark");
    }
  }, [preferences]);

  const applyTheme = (newTheme: "light" | "dark") => {
    if (newTheme === "dark") {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  };

  const handleThemeChange = (isDark: boolean) => {
    const newTheme = isDark ? "dark" : "light";
    setTheme(newTheme);
    applyTheme(newTheme);
    updatePreferences.mutate({ theme: newTheme });
  };

  const handleNotificationChange = async (type: "email" | "push" | "sound", value: boolean) => {
    if (type === "email") {
      updatePreferences.mutate({ email_notifications: value });
    } else if (type === "push") {
      // === NATIVE APP: device token through the shell's push plugin ===
      if (isNativePlatform()) {
        if (value) {
          const { data: { session } } = await supabase.auth.getSession();
          if (!session?.user) {
            toast({ title: "Not logged in", description: "You must be logged in to enable notifications.", variant: "destructive" });
            return;
          }
          const result = await enablePushOnThisDevice();
          if (result.status === "enabled") {
            setPushStatus("subscribed");
            updatePreferences.mutate({ push_notifications: true });
            toast({ title: "Notifications enabled", description: "This phone will be notified about exams, homework and tasks." });
          } else if (result.status === "denied") {
            setPushStatus("denied");
            toast({ title: "Notifications are blocked", description: "Allow notifications for SALCI in your phone's Settings, then try again." });
          } else if (result.status === "unsupported") {
            setPushStatus("unsupported");
            toast({ title: "Update the app", description: "This version of the app cannot receive notifications." });
          } else {
            toastError(new Error(result.reason), {
              fallback: "Couldn't register this phone for notifications. Please try again later.",
              context: "enablePushOnThisDevice",
            });
          }
        } else {
          await disablePushOnThisDevice();
          setPushStatus("unsubscribed");
          updatePreferences.mutate({ push_notifications: false });
          toast({ title: "Notifications turned off on this phone" });
        }
        return;
      }
      if (value) {
        // === SUBSCRIBE FLOW ===
        if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
          toast({ title: "Not supported", description: "Push notifications are not supported in this browser.", variant: "destructive" });
          setPushStatus("unsupported");
          return;
        }
        if (!VAPID_PUBLIC_KEY) {
          toast({ title: "Configuration error", description: "VAPID public key is not configured.", variant: "destructive" });
          return;
        }

        // iOS Safari non-PWA check
        const isIOSSafariNotStandalone = () => {
          const ua = navigator.userAgent;
          const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
          const isStandalone = (window.navigator as Navigator & { standalone?: boolean }).standalone === true || window.matchMedia('(display-mode: standalone)').matches;
          return isIOS && !isStandalone;
        };

        if (isIOSSafariNotStandalone()) {
          setPushStatus("unsubscribed");
          alert('iOS users: You must tap the Share button and select "Add to Home Screen" before you can enable notifications.');
          return;
        }

        try {
          const permission = await Notification.requestPermission();
          if (permission !== "granted") {
            setPushStatus("denied");
            alert('Action Required: You blocked notifications. You must click the lock icon in your browser URL bar, change Notifications to Allow, and refresh the page.');
            return;
          }

          const registration = await navigator.serviceWorker.register("/sw.js");

          // Wait for SW to become active before subscribing
          if (!registration.active) {
            await new Promise<void>((resolve) => {
              const sw = registration.installing || registration.waiting;
              if (!sw) { resolve(); return; }
              sw.addEventListener("statechange", () => {
                if (sw.state === "activated") resolve();
              });
            });
          }

          const subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
          });

          const json = subscription.toJSON();
          const endpoint = json.endpoint!;
          const p256dh = json.keys!.p256dh;
          const auth = json.keys!.auth;

          const { data: { user } } = await supabase.auth.getUser();
          if (!user) {
            toast({ title: "Not logged in", description: "You must be logged in to enable push notifications.", variant: "destructive" });
            return;
          }

          const { error } = await supabase.from("push_subscriptions").upsert(
            { user_id: user.id, endpoint, p256dh, auth_key: auth },
            { onConflict: "user_id,endpoint" }
          );

          if (error) {
            console.error("Failed to save push subscription:", error);
            toast({ title: "Error", description: "Failed to save subscription.", variant: "destructive" });
            return;
          }

          setPushStatus("subscribed");
          updatePreferences.mutate({ push_notifications: true });
          toast({ title: "Background notifications enabled", description: "You will now receive push notifications even when the tab is closed." });
        } catch (err) {
          console.error("Push subscription error:", err);
          toast({ title: "Error", description: "Something went wrong enabling notifications.", variant: "destructive" });
        }
      } else {
        // === UNSUBSCRIBE FLOW ===
        try {
          const registration = await navigator.serviceWorker.getRegistration("/sw.js");
          if (registration) {
            const subscription = await registration.pushManager.getSubscription();
            if (subscription) {
              const endpoint = subscription.endpoint;
              await subscription.unsubscribe();

              const { data: { user } } = await supabase.auth.getUser();
              if (user) {
                await supabase.from("push_subscriptions").delete().eq("user_id", user.id).eq("endpoint", endpoint);
              }
            }
          }
          setPushStatus("unsubscribed");
          updatePreferences.mutate({ push_notifications: false });
          toast({ title: "Background notifications disabled" });
        } catch (err) {
          console.error("Push unsubscribe error:", err);
          toast({ title: "Error", description: "Failed to disable notifications.", variant: "destructive" });
        }
      }
    } else if (type === "sound") {
      updatePreferences.mutate({ sound_notifications: value });
    }
  };

  const handlePasswordChange = async () => {
    setPasswordErrors({});
    
    const result = passwordSchema.safeParse(passwordForm);
    if (!result.success) {
      const errors: Record<string, string> = {};
      result.error.errors.forEach((err) => {
        if (err.path[0]) {
          errors[err.path[0] as string] = err.message;
        }
      });
      setPasswordErrors(errors);
      return;
    }

    setIsChangingPassword(true);
    try {
      const { error } = await supabase.auth.updateUser({
        password: passwordForm.newPassword,
      });

      if (error) throw error;

      toast({
        title: "Password updated",
        description: "Your password has been changed successfully.",
      });
      setPasswordDialogOpen(false);
      setPasswordForm({ newPassword: "", confirmPassword: "" });
    } catch (error) {
      toastError(error, {
        fallback: "Couldn't update password.",
        context: "changePassword",
      });
    } finally {
      setIsChangingPassword(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Bell className="h-5 w-5 text-primary" />
            <CardTitle>Notifications</CardTitle>
          </div>
          <CardDescription>Configure how you receive notifications</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Email Notifications</Label>
              <p className="text-sm text-muted-foreground">
                Receive updates about exams and results via email
              </p>
            </div>
            <Switch 
              checked={preferences?.email_notifications ?? true} 
              onCheckedChange={(checked) => handleNotificationChange("email", checked)}
              disabled={updatePreferences.isPending}
            />
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>{isNativePlatform() ? "Push Notifications" : "Background Push Notifications"}</Label>
              <p className="text-sm text-muted-foreground">
                {isNativePlatform()
                  ? pushStatus === "denied"
                    ? "Blocked for SALCI in your phone's Settings"
                    : pushStatus === "unsupported"
                    ? "Update the app to receive notifications"
                    : pushStatus === "subscribed"
                    ? "This phone receives notifications"
                    : "Get notified on this phone about exams, homework and tasks"
                  : pushStatus === "denied"
                  ? "Blocked by browser. Enable in browser settings"
                  : pushStatus === "unsupported"
                  ? "Not supported in this browser"
                  : pushStatus === "subscribed"
                  ? "Receiving notifications even when tab is closed"
                  : "Get notifications even when the browser tab is closed"}
              </p>
            </div>
            <Switch 
              checked={pushStatus === "subscribed"} 
              onCheckedChange={(checked) => handleNotificationChange("push", checked)}
              disabled={updatePreferences.isPending || pushStatus === "denied" || pushStatus === "unsupported" || pushStatus === "loading"}
            />
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Sound Alerts</Label>
              <p className="text-sm text-muted-foreground">
                Play a sound for new notifications (vibrate for urgent ones)
              </p>
            </div>
            <Switch 
              checked={preferences?.sound_notifications ?? true}
              onCheckedChange={(checked) => handleNotificationChange("sound", checked)}
              disabled={updatePreferences.isPending}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            {theme === "dark" ? (
              <Moon className="h-5 w-5 text-primary" />
            ) : (
              <Sun className="h-5 w-5 text-primary" />
            )}
            <CardTitle>Appearance</CardTitle>
          </div>
          <CardDescription>Customize how the app looks</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Dark Mode</Label>
              <p className="text-sm text-muted-foreground">Use dark theme for the application</p>
            </div>
            <Switch 
              checked={theme === "dark"} 
              onCheckedChange={handleThemeChange}
              disabled={updatePreferences.isPending}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary" />
            <CardTitle>Security</CardTitle>
          </div>
          <CardDescription>Manage your account security</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Two-Factor Authentication</Label>
              <p className="text-sm text-muted-foreground">Add an extra layer of security</p>
            </div>
            <Switch 
              checked={false} 
              onCheckedChange={() => toast({ 
                title: "Coming soon", 
                description: "Two-factor authentication will be available in a future update." 
              })} 
            />
          </div>
          <Separator />
          <div className="space-y-2">
            <Label>Password</Label>
            <p className="text-sm text-muted-foreground">Change your password</p>
            <Dialog open={passwordDialogOpen} onOpenChange={setPasswordDialogOpen}>
              <DialogTrigger asChild>
                <Button variant="outline">Change Password</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Change Password</DialogTitle>
                  <DialogDescription>
                    Enter your new password below. Make sure it's at least 8 characters long.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label htmlFor="new-password">New Password</Label>
                    <div className="relative">
                      <Input
                        id="new-password"
                        type={showNewPassword ? "text" : "password"}
                        value={passwordForm.newPassword}
                        onChange={(e) => setPasswordForm({ ...passwordForm, newPassword: e.target.value })}
                        placeholder="Enter new password"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7"
                        onClick={() => setShowNewPassword(!showNewPassword)}
                      >
                        {showNewPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </Button>
                    </div>
                    {passwordErrors.newPassword && (
                      <p className="text-sm text-destructive">{passwordErrors.newPassword}</p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="confirm-password">Confirm New Password</Label>
                    <div className="relative">
                      <Input
                        id="confirm-password"
                        type={showConfirmPassword ? "text" : "password"}
                        value={passwordForm.confirmPassword}
                        onChange={(e) => setPasswordForm({ ...passwordForm, confirmPassword: e.target.value })}
                        placeholder="Confirm new password"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7"
                        onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                      >
                        {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </Button>
                    </div>
                    {passwordErrors.confirmPassword && (
                      <p className="text-sm text-destructive">{passwordErrors.confirmPassword}</p>
                    )}
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setPasswordDialogOpen(false)}>
                    Cancel
                  </Button>
                  <Button onClick={handlePasswordChange} disabled={isChangingPassword}>
                    {isChangingPassword && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    Update Password
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </CardContent>
      </Card>

      {/* Staff only, and only once PTMs are on and the online PTM migration
          is live; the card renders nothing otherwise. */}
      <GoogleAccountCard />
    </div>
  );
}

function APIKeySettings() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});

  const { data: configs, isLoading } = useQuery({
    queryKey: ["ai-config"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("global_ai_config")
        .select("*")
        .order("config_key");
      if (error) throw error;
      return data || [];
    },
  });

  const [formData, setFormData] = useState<Record<string, { value: string; enabled: boolean }>>({});

  useEffect(() => {
    if (configs) {
      const initial: Record<string, { value: string; enabled: boolean }> = {};
      configs.forEach(c => {
        initial[c.config_key] = { value: c.config_value || "", enabled: c.is_enabled };
      });
      setFormData(initial);
    }
  }, [configs]);

  const updateConfig = useMutation({
    mutationFn: async ({ key, value, enabled }: { key: string; value: string; enabled: boolean }) => {
      return invokeAdminOperation<unknown>({
        action: "update_ai_config",
        data: { configKey: key, configValue: value, isEnabled: enabled },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ai-config"] });
      toast({ title: "Configuration saved" });
    },
    onError: (error: Error) =>
      toastError(error, { fallback: "Couldn't save configuration.", context: "updateAIConfig" }),
  });

  const defaultKeys = ["OPENAI_API_KEY", "GEMINI_API_KEY", "OCR_API_KEY"];

  const handleSaveKey = (key: string) => {
    const data = formData[key];
    if (data) {
      updateConfig.mutate({ key, value: data.value, enabled: data.enabled });
    }
  };

  const toggleShow = (key: string) => {
    setShowKeys(prev => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Key className="h-5 w-5 text-primary" />
            <CardTitle>API Keys</CardTitle>
          </div>
          <CardDescription>
            Configure API keys for AI services. Keys are encrypted and stored securely.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {defaultKeys.map((key) => {
            const data = formData[key] || { value: "", enabled: true };
            const existing = configs?.find(c => c.config_key === key);
            
            return (
              <div key={key} className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label className="font-medium">{key.replace(/_/g, " ")}</Label>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">Enabled</span>
                    <Switch
                      checked={data.enabled}
                      onCheckedChange={(checked) => 
                        setFormData(prev => ({ ...prev, [key]: { ...data, enabled: checked } }))
                      }
                    />
                  </div>
                </div>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Input
                      type={showKeys[key] ? "text" : "password"}
                      value={data.value}
                      onChange={(e) => 
                        setFormData(prev => ({ ...prev, [key]: { ...data, value: e.target.value } }))
                      }
                      placeholder={existing ? "••••••••••••••••" : "Enter API key"}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7"
                      onClick={() => toggleShow(key)}
                    >
                      {showKeys[key] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </Button>
                  </div>
                  <Button
                    onClick={() => handleSaveKey(key)}
                    disabled={updateConfig.isPending}
                    size="icon"
                  >
                    {updateConfig.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Save className="h-4 w-4" />
                    )}
                  </Button>
                </div>
                {existing && (
                  <p className="text-xs text-muted-foreground">
                    Last updated: {new Date(existing.updated_at).toLocaleDateString()}
                  </p>
                )}
                <Separator />
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}

function AIQuotaSettings() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: quotas, isLoading } = useQuery({
    queryKey: ["ai-quotas"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ai_usage_quotas")
        .select(`
          *,
          institutions (id, name, code)
        `)
        .order("institution_id");
      if (error) throw error;
      return data || [];
    },
  });

  const updateQuota = useMutation({
    mutationFn: async (data: {
      institutionId: string;
      dailyQuestionLimit?: number;
      dailyTokenLimit?: number;
      monthlyTokenLimit?: number;
      questionGenerationEnabled?: boolean;
      ocrEnabled?: boolean;
    }) => {
      return invokeAdminOperation<unknown>({ action: "update_quota", data });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ai-quotas"] });
      toast({ title: "Quota updated" });
    },
    onError: (error: Error) =>
      toastError(error, { fallback: "Couldn't update quota.", context: "updateQuota" }),
  });

  if (isLoading) {
    return <div className="p-4">Loading...</div>;
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Brain className="h-5 w-5 text-primary" />
            <CardTitle>AI Usage Quotas</CardTitle>
          </div>
          <CardDescription>
            Configure AI generation limits per institution
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {quotas?.map((quota) => (
            <div key={quota.id} className="border rounded-lg p-4 space-y-4">
              <div className="flex items-center gap-2">
                <Building2 className="h-4 w-4 text-muted-foreground" />
                <span className="font-medium">
                  {quota.institutions?.name || "Unknown"} ({quota.institutions?.code})
                </span>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Daily Question Limit</Label>
                  <Input
                    type="number"
                    defaultValue={quota.daily_question_limit}
                    onBlur={(e) => {
                      const value = parseInt(e.target.value);
                      if (!isNaN(value) && value !== quota.daily_question_limit) {
                        updateQuota.mutate({
                          institutionId: quota.institution_id!,
                          dailyQuestionLimit: value,
                        });
                      }
                    }}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Daily Token Limit</Label>
                  <Input
                    type="number"
                    defaultValue={quota.daily_token_limit}
                    onBlur={(e) => {
                      const value = parseInt(e.target.value);
                      if (!isNaN(value) && value !== quota.daily_token_limit) {
                        updateQuota.mutate({
                          institutionId: quota.institution_id!,
                          dailyTokenLimit: value,
                        });
                      }
                    }}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Monthly Token Limit</Label>
                  <Input
                    type="number"
                    defaultValue={quota.monthly_token_limit}
                    onBlur={(e) => {
                      const value = parseInt(e.target.value);
                      if (!isNaN(value) && value !== quota.monthly_token_limit) {
                        updateQuota.mutate({
                          institutionId: quota.institution_id!,
                          monthlyTokenLimit: value,
                        });
                      }
                    }}
                  />
                </div>
              </div>

              <div className="flex gap-6">
                <div className="flex items-center gap-2">
                  <Switch
                    checked={quota.question_generation_enabled}
                    onCheckedChange={(checked) => {
                      updateQuota.mutate({
                        institutionId: quota.institution_id!,
                        questionGenerationEnabled: checked,
                      });
                    }}
                  />
                  <Label className="text-sm">Question Generation</Label>
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    checked={quota.ocr_enabled}
                    onCheckedChange={(checked) => {
                      updateQuota.mutate({
                        institutionId: quota.institution_id!,
                        ocrEnabled: checked,
                      });
                    }}
                  />
                  <Label className="text-sm">OCR Processing</Label>
                </div>
              </div>
            </div>
          ))}

          {(!quotas || quotas.length === 0) && (
            <p className="text-muted-foreground text-center py-8">
              No institutions with AI quotas configured. Create an institution first.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
