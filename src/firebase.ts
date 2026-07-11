import { initializeApp, getApps } from 'firebase/app';
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  getFirestore,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import type { Card, Deck, NewCard, Repository, Section } from './types';

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

export const isFirebaseConfigured = Object.values(config).every(Boolean);

const db = isFirebaseConfigured ? getFirestore(getApps()[0] ?? initializeApp(config)) : null;

function defaultSection(now = Date.now()): Omit<Section, 'id'> {
  return { name: '기본', sourceText: '', createdAt: now, updatedAt: now };
}

export function createFirebaseRepository(roomCode: string): Repository | null {
  if (!db) return null;

  const decksPath = collection(db, 'rooms', roomCode, 'decks');

  return {
    mode: 'firebase',
    subscribeDecks(callback, onError) {
      const decksQuery = query(decksPath, orderBy('createdAt', 'asc'));
      return onSnapshot(decksQuery, (snapshot) => {
        callback(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as Deck));
      }, (error) => onError?.(error));
    },
    subscribeCards(deckId, callback, onError) {
      const cardsPath = collection(db, 'rooms', roomCode, 'decks', deckId, 'cards');
      const cardsQuery = query(cardsPath, orderBy('createdAt', 'asc'));
      return onSnapshot(cardsQuery, (snapshot) => {
        callback(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as Card));
      }, (error) => onError?.(error));
    },
    subscribeSections(deckId, callback, onError) {
      const sectionsPath = collection(db, 'rooms', roomCode, 'decks', deckId, 'sections');
      const sectionsQuery = query(sectionsPath, orderBy('createdAt', 'asc'));
      return onSnapshot(sectionsQuery, (snapshot) => {
        callback(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as Section));
      }, (error) => onError?.(error));
    },
    async ensureDefaultDeck() {
      return Promise.resolve();
      const now = Date.now();
      await setDoc(
        doc(db!, 'rooms', roomCode, 'decks', 'default'),
        { name: '기본 암기장', createdAt: now, updatedAt: now },
        { merge: true },
      );
      await setDoc(
        doc(db!, 'rooms', roomCode, 'decks', 'default', 'sections', 'default'),
        defaultSection(now),
        { merge: true },
      );
    },
    async addDeck(name) {
      const now = Date.now();
      const deckRef = doc(decksPath);
      await setDoc(deckRef, { name, createdAt: now, updatedAt: now });
      return deckRef.id;
    },
    async renameDeck(deckId, name) {
      await updateDoc(doc(db, 'rooms', roomCode, 'decks', deckId), { name, updatedAt: Date.now() });
    },
    async deleteDeck(deckId) {
      const cardsSnapshot = await getDocs(collection(db, 'rooms', roomCode, 'decks', deckId, 'cards'));
      const sectionsSnapshot = await getDocs(collection(db, 'rooms', roomCode, 'decks', deckId, 'sections'));
      await Promise.all([
        ...cardsSnapshot.docs.map((cardDoc) => deleteDoc(cardDoc.ref)),
        ...sectionsSnapshot.docs.map((sectionDoc) => deleteDoc(sectionDoc.ref)),
      ]);
      await deleteDoc(doc(db, 'rooms', roomCode, 'decks', deckId));
    },
    async addSection(deckId, name) {
      const now = Date.now();
      const sectionRef = doc(collection(db, 'rooms', roomCode, 'decks', deckId, 'sections'));
      await setDoc(sectionRef, { name, sourceText: '', createdAt: now, updatedAt: now });
      return sectionRef.id;
    },
    async renameSection(deckId, sectionId, name) {
      await updateDoc(doc(db, 'rooms', roomCode, 'decks', deckId, 'sections', sectionId), {
        name,
        updatedAt: Date.now(),
      });
    },
    async deleteSection(deckId, sectionId) {
      const cardsSnapshot = await getDocs(collection(db, 'rooms', roomCode, 'decks', deckId, 'cards'));
      await Promise.all(
        cardsSnapshot.docs
          .filter((cardDoc) => ((cardDoc.data() as Card).sectionId ?? 'default') === sectionId)
          .map((cardDoc) => deleteDoc(cardDoc.ref)),
      );
      await deleteDoc(doc(db, 'rooms', roomCode, 'decks', deckId, 'sections', sectionId));
    },
    async setSectionContent(deckId, sectionId, sourceText, cards: NewCard[]) {
      const now = Date.now();
      const cardsPath = collection(db, 'rooms', roomCode, 'decks', deckId, 'cards');
      const cardsSnapshot = await getDocs(cardsPath);
      await Promise.all(
        cardsSnapshot.docs
          .filter((cardDoc) => ((cardDoc.data() as Card).sectionId ?? 'default') === sectionId)
          .map((cardDoc) => deleteDoc(cardDoc.ref)),
      );
      await Promise.all(
        cards.map((card) => {
          const cardRef = doc(cardsPath);
          return setDoc(cardRef, { ...card, sectionId, createdAt: now, updatedAt: now });
        }),
      );
      await setDoc(
        doc(db, 'rooms', roomCode, 'decks', deckId, 'sections', sectionId),
        { sourceText, updatedAt: now },
        { merge: true },
      );
    },
    async toggleCardStar(deckId, cardId, starred) {
      await updateDoc(doc(db, 'rooms', roomCode, 'decks', deckId, 'cards', cardId), {
        starred,
        ...(starred ? { mastered: false } : {}),
        updatedAt: Date.now(),
      });
    },
    async setCardAnswerMastery(deckId, cardId, answerMastery) {
      const mastered = answerMastery.length > 0 && answerMastery.every(Boolean);
      await updateDoc(doc(db, 'rooms', roomCode, 'decks', deckId, 'cards', cardId), {
        answerMastery,
        mastered,
        ...(mastered ? { starred: false } : {}),
        updatedAt: Date.now(),
      });
    },
  };
}
