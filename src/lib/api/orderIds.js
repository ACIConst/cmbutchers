import { doc, runTransaction } from "firebase/firestore";
import { db } from "../../config/firebase";

export async function generateOrderId() {
  const counterRef = doc(db, "kioskConfig", "orderCounter");
  const year = new Date().getFullYear();

  try {
    const newNum = await runTransaction(db, async (transaction) => {
      const counterDoc = await transaction.get(counterRef);
      const lastNumber = counterDoc.exists() ? counterDoc.data().lastNumber || 0 : 0;
      const nextNumber = lastNumber + 1;
      transaction.set(counterRef, { lastNumber: nextNumber, prefix: "CB" }, { merge: true });
      return nextNumber;
    });

    return `CB-${year}-${String(newNum).padStart(4, "0")}`;
  } catch (e) {
    throw new Error(`Failed to generate order ID: ${e.message}`);
  }
}
