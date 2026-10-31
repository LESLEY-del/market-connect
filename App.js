import React, { useEffect, useRef, useState } from "react";
import {
  View, Text, TextInput, FlatList, TouchableOpacity, StyleSheet, Alert,
  BackHandler, StatusBar as RNStatusBar, Platform, KeyboardAvoidingView, ScrollView,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { WebView } from "react-native-webview";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { API_URL, SAMPLE_STORES } from "./config";
import Splash from "./Splash";
import Logo from "./Logo";

const KEY = "mrp_current_store", TKEY = "mrp_token";
const TOP = Platform.OS === "android" ? RNStatusBar.currentHeight || 24 : 44;
const COLORS = ["#0F766E", "#B45309", "#1D4ED8", "#9D174D", "#6D28D9", "#047857"];
const colorFor = (n) => COLORS[(n.charCodeAt(0) + n.length) % COLORS.length];
const post = (path, body, token) =>
  fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });

export default function App() {
  const [stores, setStores] = useState([]);
  const [current, setCurrent] = useState(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [pageLoading, setPageLoading] = useState(false);
  const [token, setToken] = useState(null);
  const [me, setMe] = useState(null);
  const [showLogin, setShowLogin] = useState(false);
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const web = useRef(null);
  const canGoBack = useRef(false);

  const loadMe = async (t) => {
    try {
      const r = await fetch(`${API_URL}/api/me`, { headers: { Authorization: `Bearer ${t}` } });
      if (!r.ok) throw 0;
      setMe(await r.json()); setToken(t);
    } catch (e) { await AsyncStorage.removeItem(TKEY); setToken(null); setMe(null); }
  };

  useEffect(() => {
    (async () => {
      const started = Date.now();
      let list = SAMPLE_STORES;
      if (API_URL) { try { list = await (await fetch(`${API_URL}/stores`)).json(); } catch (e) {} }
      setStores(list);
      try {
        const saved = await AsyncStorage.getItem(KEY);
        if (saved) { const live = list.find((x) => x.id === JSON.parse(saved).id); if (live) setCurrent(live); }
        const t = API_URL && (await AsyncStorage.getItem(TKEY));
        if (t) await loadMe(t);
      } catch (e) {}
      setTimeout(() => setLoading(false), Math.max(0, 2200 - (Date.now() - started)));
    })();
  }, []);

  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (current && canGoBack.current) { web.current?.goBack(); return true; }
      if (showLogin) { setShowLogin(false); return true; }
      return false;
    });
    return () => sub.remove();
  }, [current, showLogin]);

  const open = async (s, persist = true) => {
    if (persist) await AsyncStorage.setItem(KEY, JSON.stringify(s));
    setCurrent(s);
  };
  const switchWorkspace = async () => { await AsyncStorage.removeItem(KEY); setCurrent(null); };

  const login = async () => {
    setErr("");
    try {
      const r = await post("/api/login", { email, password: pw });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Login failed");
      if (d.role === "admin") throw new Error("Admins sign in on the website dashboard.");
      await AsyncStorage.setItem(TKEY, d.token);
      await loadMe(d.token);
      setShowLogin(false); setPw("");
    } catch (e) { setErr(e.message === "Network request failed" ? "Can't reach the server." : e.message); }
  };
  const logout = async () => { await AsyncStorage.removeItem(TKEY); setToken(null); setMe(null); };

  const openOwn = () => {
    const s = me.store;
    if (!s) return Alert.alert("No store yet", "Add your store on the owner website first.");
    if (me.live) return open({ id: s.id, name: s.name, url: s.url, logo: s.logo });
    const why = !s.approved ? "It is waiting for approval." : "Your R50 payment is needed to go live.";
    Alert.alert("Your store isn't live yet", why, [
      { text: "Preview it", onPress: () => open({ id: s.id, name: s.name, url: s.url, logo: s.logo }, false) },
      { text: "OK", style: "cancel" },
    ]);
  };

  if (loading) return (<><StatusBar style="light" /><Splash /></>);

  if (current) {
    return (
      <View style={st.flex}>
        <StatusBar style="light" />
        <View style={st.bar}>
          <View style={[st.avatarSm, { backgroundColor: colorFor(current.name) }]}>
            <Text style={st.avatarSmTxt}>{current.logo || current.name[0]}</Text>
          </View>
          <Text style={st.barTitle} numberOfLines={1}>{current.name}</Text>
          <TouchableOpacity style={st.switchBtn} onPress={switchWorkspace}><Text style={st.switchTxt}>⇄ Switch</Text></TouchableOpacity>
        </View>
        {pageLoading && <View style={st.progress} />}
        <WebView
          ref={web} source={{ uri: current.url }}
          sharedCookiesEnabled thirdPartyCookiesEnabled domStorageEnabled javaScriptEnabled
          onLoadStart={() => setPageLoading(true)} onLoadEnd={() => setPageLoading(false)}
          onNavigationStateChange={(n) => (canGoBack.current = n.canGoBack)}
        />
      </View>
    );
  }

  if (showLogin) {
    return (
      <KeyboardAvoidingView style={st.home} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <StatusBar style="light" />
        <ScrollView contentContainerStyle={{ flexGrow: 1 }} keyboardShouldPersistTaps="handled">
          <View style={st.header}>
            <Logo size={64} /><Text style={st.title}>Store owner login</Text>
            <Text style={st.sub}>See your store inside the app</Text>
          </View>
          <View style={{ padding: 22 }}>
            <TextInput style={st.field} placeholder="Email" autoCapitalize="none" keyboardType="email-address" value={email} onChangeText={setEmail} />
            <TextInput style={st.field} placeholder="Password" secureTextEntry value={pw} onChangeText={setPw} />
            {!!err && <Text style={st.err}>{err}</Text>}
            <TouchableOpacity style={st.primary} onPress={login}><Text style={st.primaryTxt}>Log in</Text></TouchableOpacity>
            <Text style={st.note}>New owner? Create your account and add your store on the Market Rental Place owner website.</Text>
            <TouchableOpacity onPress={() => setShowLogin(false)}><Text style={st.link}>← Back to stores</Text></TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  const shown = stores.filter((s) => s.name.toLowerCase().includes(query.toLowerCase()));
  const own = me && me.store;
  const status = !own ? "No store added yet" : me.live ? "LIVE · tap to open" : !own.approved ? "Waiting for approval" : "Payment needed to go live";
  return (
    <View style={st.home}>
      <StatusBar style="light" />
      <View style={st.header}>
        {!!API_URL && (
          <TouchableOpacity style={st.ownerBtn} onPress={me ? logout : () => setShowLogin(true)}>
            <Text style={st.ownerBtnTxt}>{me ? "Log out" : "Owner login"}</Text>
          </TouchableOpacity>
        )}
        <Logo size={64} />
        <Text style={st.title}>Market Rental Place</Text>
        <Text style={st.sub}>Which store are you looking for?</Text>
        <View style={st.searchBox}>
          <Text style={st.searchIcon}>🔍</Text>
          <TextInput style={st.input} placeholder="Search stores..." placeholderTextColor="#94A3B8" value={query} onChangeText={setQuery} />
        </View>
      </View>
      <FlatList
        data={shown} keyExtractor={(s) => s.id} contentContainerStyle={{ padding: 18 }}
        ListHeaderComponent={
          <View>
            {me && (
              <TouchableOpacity style={st.own} activeOpacity={0.85} onPress={openOwn}>
                <Text style={st.ownTag}>YOUR STORE</Text>
                <Text style={st.ownName}>{own ? `${own.logo || "🏪"} ${own.name}` : "Add your store"}</Text>
                <Text style={st.ownStatus}>{status}</Text>
              </TouchableOpacity>
            )}
            <Text style={st.section}>{shown.length} store{shown.length === 1 ? "" : "s"} available</Text>
          </View>
        }
        ListEmptyComponent={<Text style={st.empty}>No stores found.</Text>}
        renderItem={({ item }) => (
          <TouchableOpacity style={st.card} activeOpacity={0.85} onPress={() => open(item)}>
            <View style={[st.avatar, { backgroundColor: colorFor(item.name) + "22" }]}>
              <Text style={st.avatarTxt}>{item.logo || item.name[0]}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={st.name}>{item.name}</Text>
              <Text style={st.open}>Tap to enter store</Text>
            </View>
            <Text style={st.arrow}>›</Text>
          </TouchableOpacity>
        )}
      />
    </View>
  );
}

const st = StyleSheet.create({
  flex: { flex: 1, backgroundColor: "#fff" },
  home: { flex: 1, backgroundColor: "#F1F5F9" },
  header: { backgroundColor: "#0F766E", paddingTop: TOP + 16, paddingHorizontal: 20, paddingBottom: 24, alignItems: "center", borderBottomLeftRadius: 28, borderBottomRightRadius: 28 },
  ownerBtn: { position: "absolute", right: 16, top: TOP + 10, backgroundColor: "rgba(255,255,255,0.18)", paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16 },
  ownerBtnTxt: { color: "#fff", fontWeight: "600", fontSize: 13 },
  title: { color: "#fff", fontSize: 24, fontWeight: "800", marginTop: 10 },
  sub: { color: "#CCFBF1", fontSize: 15, marginTop: 4, marginBottom: 16 },
  searchBox: { flexDirection: "row", alignItems: "center", backgroundColor: "#fff", borderRadius: 14, paddingHorizontal: 14, width: "100%", elevation: 3 },
  searchIcon: { fontSize: 16, marginRight: 8 },
  input: { flex: 1, paddingVertical: 12, fontSize: 16, color: "#0F172A" },
  own: { backgroundColor: "#0F172A", borderRadius: 18, padding: 18, marginBottom: 18, elevation: 4 },
  ownTag: { color: "#F59E0B", fontSize: 12, fontWeight: "800", letterSpacing: 1 },
  ownName: { color: "#fff", fontSize: 22, fontWeight: "800", marginTop: 6 },
  ownStatus: { color: "#CBD5E1", fontSize: 14, marginTop: 4 },
  section: { color: "#64748B", fontSize: 13, fontWeight: "600", marginBottom: 12, textTransform: "uppercase", letterSpacing: 0.6 },
  card: { flexDirection: "row", alignItems: "center", backgroundColor: "#fff", borderRadius: 16, padding: 14, marginBottom: 12, elevation: 2 },
  avatar: { width: 54, height: 54, borderRadius: 16, alignItems: "center", justifyContent: "center", marginRight: 14 },
  avatarTxt: { fontSize: 26, fontWeight: "700" },
  name: { fontSize: 17, fontWeight: "700", color: "#0F172A" },
  open: { fontSize: 13, color: "#64748B", marginTop: 2 },
  arrow: { fontSize: 30, color: "#94A3B8" },
  empty: { textAlign: "center", color: "#94A3B8", marginTop: 40, fontSize: 16 },
  field: { backgroundColor: "#fff", borderRadius: 12, padding: 14, fontSize: 16, marginBottom: 12, borderWidth: 1, borderColor: "#E2E8F0" },
  primary: { backgroundColor: "#0F766E", borderRadius: 14, padding: 15, alignItems: "center", marginTop: 4 },
  primaryTxt: { color: "#fff", fontSize: 17, fontWeight: "700" },
  err: { color: "#B91C1C", marginBottom: 8 },
  note: { color: "#64748B", marginTop: 18, lineHeight: 20 },
  link: { color: "#0F766E", fontWeight: "700", marginTop: 18 },
  bar: { flexDirection: "row", alignItems: "center", backgroundColor: "#0F766E", paddingTop: TOP + 8, paddingBottom: 10, paddingHorizontal: 14 },
  avatarSm: { width: 34, height: 34, borderRadius: 10, alignItems: "center", justifyContent: "center", marginRight: 10 },
  avatarSmTxt: { color: "#fff", fontWeight: "700", fontSize: 16 },
  barTitle: { color: "#fff", fontSize: 17, fontWeight: "700", flex: 1 },
  switchBtn: { backgroundColor: "#F59E0B", paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20 },
  switchTxt: { color: "#fff", fontWeight: "700" },
  progress: { height: 3, backgroundColor: "#F59E0B" },
});
