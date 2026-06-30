/**
 * Reservations router — list / new / detail, all full-page (no slide-over for primary work).
 *   #/reservations        → list
 *   #/reservations/new    → booking flow
 *   #/reservations/<id>   → reservation workspace
 */

import ReservationsList from "./ReservationsList";
import NewBooking from "./NewBooking";
import ReservationDetail from "./ReservationDetail";

export default function ReservationsScreen({ id }: { id: string | null }) {
	if (!id) return <ReservationsList />;
	if (id === "new") return <NewBooking />;
	return <ReservationDetail reservation={id} />;
}
