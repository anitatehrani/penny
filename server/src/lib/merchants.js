// What Penny knows about shops, brands and words in a bank statement (docs/DESIGN.md section 41). Nothing here is personal: it is a list of
// well-known names and common words, each saying what kind of spending it is. The person's own choices (import_rules) and their own earlier
// payments always come before it.
//
// Entries: "Display Name" (the name is also what is looked for), "Display Name=other spelling|another", a trailing * means "starts with"
// (supermercat* is supermercato, supermercati ...), a leading ? means "a weak sign" (the line is then marked to be checked).

/** What a label is in a budget: its kind, the name given to a new category, a colour, and the names an existing category may already have. */
export const LABELS = {
  groceries: { kind: 'expense', name: 'Groceries', color: '#008300', alias: ['Groceries', 'Grocery', 'Supermarket', 'Supermarkets', 'Food', 'Food & groceries', 'Food and groceries', 'Shopping - groceries', 'Spesa', 'Alimentari'] },
  dining: { kind: 'expense', name: 'Restaurants', color: '#9085e9', alias: ['Dining & leisure', 'Restaurants', 'Restaurant', 'Dining', 'Eating out', 'Food & drink', 'Restaurants & bars', 'Restaurants & cafes', 'Cafes & restaurants', 'Cafes', 'Ristoranti', 'Bars & restaurants'] },
  clothing: { kind: 'expense', name: 'Clothing', color: '#e87ba4', alias: ['Clothing', 'Clothes', 'Fashion', 'Apparel', 'Clothing & shoes', 'Shoes & clothing', 'Abbigliamento'] },
  transport: { kind: 'expense', name: 'Transport', color: '#2a78d6', alias: ['Transport', 'Transportation', 'Travel & transport', 'Getting around', 'Commute', 'Car & transport', 'Car', 'Fuel', 'Trasporti'] },
  shopping: { kind: 'expense', name: 'Shopping', color: '#eb6834', alias: ['Shopping', 'Shopping & online', 'General shopping', 'Online shopping', 'Purchases', 'Acquisti'] },
  subscriptions: { kind: 'expense', name: 'Subscriptions', color: '#e87ba4', alias: ['Subscriptions', 'Subscription', 'Streaming', 'Memberships', 'Abbonamenti'] },
  utilities: { kind: 'expense', name: 'Utilities', color: '#eda100', alias: ['Utilities', 'Bills', 'Bills & utilities', 'Household bills', 'Phone & internet', 'Phone', 'Utenze', 'Bollette'] },
  rent: { kind: 'expense', name: 'Rent / Mortgage', color: '#4a3aa7', alias: ['Rent / Mortgage', 'Rent', 'Mortgage', 'Rent & mortgage', 'Housing', 'Affitto', 'Mutuo'] },
  loans: { kind: 'expense', name: 'Installments & loans', color: '#e34948', alias: ['Installments & loans', 'Loans', 'Loan payments', 'Installments', 'Credit', 'Debt', 'Finanziamenti'] },
  health: { kind: 'expense', name: 'Health', color: '#1baf7a', alias: ['Health', 'Healthcare', 'Medical', 'Pharmacy', 'Health & fitness', 'Salute'] },
  fitness: { kind: 'expense', name: 'Fitness', color: '#1baf7a', alias: ['Fitness', 'Sports', 'Sport', 'Gym', 'Health & fitness', 'Health'] },
  personal_care: { kind: 'expense', name: 'Personal care', color: '#e87ba4', alias: ['Personal care', 'Beauty', 'Beauty & personal care', 'Hair & beauty', 'Cura della persona', 'Health'] },
  entertainment: { kind: 'expense', name: 'Entertainment', color: '#9085e9', alias: ['Entertainment', 'Leisure', 'Fun', 'Dining & leisure', 'Hobbies', 'Free time', 'Tempo libero'] },
  travel: { kind: 'expense', name: 'Travel', color: '#2a78d6', alias: ['Travel', 'Holidays', 'Vacation', 'Trips', 'Travel & holidays', 'Viaggi'] },
  insurance: { kind: 'expense', name: 'Insurance', color: '#4a3aa7', alias: ['Insurance', 'Insurances', 'Assicurazioni'] },
  education: { kind: 'expense', name: 'Education', color: '#2a78d6', alias: ['Education', 'School', 'Courses', 'Learning', 'Istruzione'] },
  gifts: { kind: 'expense', name: 'Gifts', color: '#eb6834', alias: ['Birthdays & gifts', 'Gifts', 'Presents', 'Gifts & donations', 'Regali'] },
  home: { kind: 'expense', name: 'Home', color: '#eda100', alias: ['Home', 'Household', 'Home & garden', 'Furniture', 'House', 'Casa'] },
  pets: { kind: 'expense', name: 'Pets', color: '#008300', alias: ['Pets', 'Pet', 'Animals'] },
  kids: { kind: 'expense', name: 'Kids', color: '#e87ba4', alias: ['Kids', 'Children', 'Child', 'Baby'] },
  donations: { kind: 'expense', name: 'Donations', color: '#e34948', alias: ['Donations', 'Charity', 'Gifts & donations'] },
  fees: { kind: 'expense', name: 'Bank fees', color: '#6b7280', alias: ['Bank fees', 'Fees', 'Bank charges', 'Fees & charges', 'Taxes & fees', 'Commissioni'] },
  taxes: { kind: 'expense', name: 'Taxes', color: '#6b7280', alias: ['Taxes', 'Tax', 'Imposte', 'Taxes & fees'] },
  cash: { kind: 'expense', name: 'Cash', color: '#6b7280', alias: ['Cash', 'Cash withdrawals', 'ATM', 'Cash & ATM', 'Prelievi', 'Withdrawals'] },
  transfers: { kind: 'both', name: 'Transfers', color: '#6b7280', alias: ['Transfers', 'Transfer', 'Transfers & payments', 'Bonifici', 'Giroconti'] },
  other: { kind: 'expense', name: 'Other', color: '#6b7280', alias: ['Other', 'Others', 'Miscellaneous', 'Misc', 'Altro'] },
  // money coming in
  salary: { kind: 'income', name: 'Salary', color: '#1baf7a', alias: ['Salary', 'Wages', 'Pay', 'Paycheck', 'Income - salary', 'Stipendio'] },
  income_other: { kind: 'income', name: 'Other income', color: '#6b7280', alias: ['Other income', 'Income', 'Other', 'Miscellaneous income', 'Altre entrate'] },
  benefits: { kind: 'income', name: 'Benefits', color: '#2a78d6', alias: ['Benefits', 'Pension', 'Pensions', 'Allowance', 'Government', 'Other income', 'Income'] },
  refunds: { kind: 'income', name: 'Refunds', color: '#1baf7a', alias: ['Refunds', 'Refund', 'Reimbursements', 'Cashback', 'Other income', 'Income'] },
  interest: { kind: 'income', name: 'Interest', color: '#2a78d6', alias: ['Interest', 'Interest & dividends', 'Dividends', 'Investment income', 'Other income', 'Income'] },
  gifts_in: { kind: 'income', name: 'Gifts received', color: '#e87ba4', alias: ['Gifts received', 'Gifts', 'Presents received'] },
  freelance: { kind: 'income', name: 'Freelance', color: '#2a78d6', alias: ['Freelance', 'Self-employed', 'Side income', 'Business income'] },
};

/** When a spending label is wanted for money coming in (a refund from a shop), these are what come instead. */
export const INCOME_FOR = { default: 'income_other', groceries: 'refunds', dining: 'refunds', clothing: 'refunds', shopping: 'refunds', subscriptions: 'refunds', travel: 'refunds', health: 'refunds', fees: 'refunds', taxes: 'refunds', utilities: 'refunds', transfers: 'transfers' };
/** And the other way round: money going out under an income label (a negative refund line). */
export const EXPENSE_FOR = { default: 'other', transfers: 'transfers' };

/** Well-known names, strongest sign. */
export const BRANDS = {
  groceries: [
    'Esselunga', 'Coop', 'Conad', 'Carrefour', 'Lidl', 'Aldi', 'Eurospin', 'Penny Market', 'MD Discount=md discount|md spa', 'Pam Panorama=pam panorama|pam local|pam', 'Iper=iper la grande i|ipercoop',
    'Bennet', 'Famila', 'Despar=despar|eurospar|interspar', 'Spar', 'Crai', 'Simply', 'Sigma', 'Tigros', 'Unes', 'U2 Supermercato=u2 supermercato', 'Todis', 'NaturaSi', 'Tuodi', 'Dedem', 'Ins Mercato',
    'Il Gigante=il gigante', 'Lombardini', 'Prix', 'Italmark', 'Maxi Di=maxi di', 'Docks Market', 'Superstore', 'Elite', 'Basko', 'Sì con te=si con te', 'A&O=a o discount', 'Mercatone', 'Metro Cash', 'Bio c bon',
    'Tesco', 'Sainsbury', 'Asda', 'Morrisons', 'Waitrose', 'Ocado', 'Marks & Spencer Food=m s food|m&s food', 'Iceland', 'Edeka', 'Rewe', 'Kaufland', 'Netto', 'Penny Markt', 'Norma', 'Migros', 'Denner', 'Coop Pronto',
    'Mercadona', 'Dia=dia supermercado', 'Auchan', 'Intermarche', 'Leclerc', 'Monoprix', 'Franprix', 'Casino Supermarche', 'Albert Heijn', 'Jumbo', 'Picnic', 'Spar Express', 'Whole Foods', 'Trader Joe', 'Safeway',
    'Kroger', 'Publix', 'Wegmans', 'Instacart', 'Delhaize', 'Colruyt', 'Hofer', 'Billa', 'Spar Gourmet',
  ],
  dining: [
    'Deliveroo', 'Glovo', 'Just Eat=just eat|justeat', 'Uber Eats=uber eats|ubereats', 'Foodora', 'Wolt', 'Too Good To Go=too good to go|tgtg', 'McDonald=mcdonald|mcdonalds|mc donald|mc donalds', 'Burger King', 'KFC', 'Subway', 'Starbucks',
    'Costa Coffee', 'Nero Coffee', 'Autogrill', 'Grom', 'Oakberry', 'Domino', 'Pizza Hut', 'Five Guys', 'Wagamama', 'Nandos', 'Pret A Manger=pret a manger|pret', 'Greggs', 'Dunkin', 'Tim Hortons', 'Chipotle',
    'Panera', 'DoorDash', 'Grubhub', 'Ciao Pizza', 'Roadhouse', 'Old Wild West', 'Vapiano', 'Rossopomodoro', 'Briscola', 'Wasabi', 'Poke House', 'Flunch', 'Quick', 'Paul Boulangerie=paul', 'Venchi', 'Sorbillo',
    'Mado', 'Rosso Pomodoro', 'La Piadineria', 'Mondo Pizza', 'Spizzico', 'Camst', 'Cremeria', 'Eataly', 'Sushi Daily', 'Rinascente Food',
  ],
  clothing: [
    'Zara', 'H&M', 'Bershka', 'Pull&Bear=pull bear|pull&bear', 'Stradivarius', 'Massimo Dutti', 'Mango', 'Uniqlo', 'Benetton', 'OVS=ovs|oviesse', 'Terranova', 'Calzedonia', 'Intimissimi', 'Tezenis', 'Yamamay', 'Primark',
    'Nike', 'Adidas', 'Foot Locker', 'Zalando', 'ASOS', 'Shein', 'Vinted', 'About You', 'Boohoo', 'Pimkie', 'Kiabi', 'C&A', 'Gap', 'Old Navy', 'Forever 21', 'Abercrombie', 'Tommy Hilfiger', 'Calvin Klein', 'Levi',
    'Diesel', 'Guess', 'Liu Jo', 'Motivi', 'Piazza Italia', 'Sisley', 'Lululemon', 'Geox', 'Decathlon', 'Sportler', 'Snipes', 'Puma', 'New Balance', 'Converse', 'Vans', 'Timberland', 'Patrizia Pepe', 'Fiorella Rubino',
    'Elena Miro', 'Carpisa', 'Tally Weijl', 'Brandy Melville', 'Cos', 'Arket', 'Weekday', 'Monki', 'Superdry', 'Scarpe', 'Camaieu', 'Jennyfer', 'Celio', 'Jules', 'Bonprix', 'Next', 'River Island', 'Topshop', 'JD Sports',
  ],
  transport: [
    'Uber=uber trip|uber bv|uber', 'Bolt', 'Lyft', 'Free Now=free now|freenow', 'Lime', 'Bird', 'Voi', 'Tier', 'Trenitalia', 'Italo', 'NTV', 'FlixBus=flixbus|flix', 'Trenord', 'ATM Milano=atm milano', 'ATAC', 'AMT Genova=amt genova',
    'Autolinee Toscane', 'TPER', 'GTT', 'Telepass', 'Autostrade', 'EasyPark', 'Yellowbrick', 'Enjoy', 'Share Now', 'BlaBlaCar=blablacar|bla bla car', 'Trainline', 'SNCF', 'Deutsche Bahn=db bahn|deutsche bahn|bahn de', 'Renfe', 'TfL=tfl|transport for london',
    'Oyster', 'Arriva', 'Eni Station=eni station|eni live|eni', 'Agip', 'Q8', 'Tamoil', 'IP Stazione=ip stazione|ip matic', 'Shell', 'Esso', 'TotalEnergies=totalenergies|total energies', 'Repsol', 'BP Station=bp station',
    'Aral', 'OMV', 'Circle K', 'Moovit', 'Cotral', 'Busitalia', 'Baltour', 'Sita', 'Atac Roma', 'Metro', 'Taxi', 'Cabify', 'Ryde', 'Zipcar', 'Getaround', 'Dott=dott scooter', 'Helbiz', 'Cityscoot', 'Mobike',
  ],
  shopping: [
    'Amazon=amazon|amzn|amazon eu|amzn mktp|www amazon', 'eBay', 'AliExpress', 'Temu', 'Wish', 'Etsy', 'IKEA', 'Leroy Merlin', 'OBI', 'Bricocenter', 'Brico', 'MediaWorld=mediaworld|media world', 'Unieuro', 'Euronics', 'Expert',
    'Apple Store=apple store', 'Samsung', 'Action', 'Tiger=flying tiger|tiger', 'HEMA', 'Miniso', 'Maisons du Monde', 'Zara Home', 'Kasanova', 'Goldenpoint', 'Sklum', 'Wayfair', 'Poltronesofa', 'Mondo Convenienza', 'Kiko',
    'Libreria=libreria|feltrinelli|mondadori|ibs|lafeltrinelli', 'Cartoleria', 'Fnac', 'Saturn', 'MediaMarkt=mediamarkt|media markt', 'Conforama', 'Castorama', 'Hornbach', 'Bauhaus', 'Dehner', 'Jysk', 'XXXLutz', 'Argos', 'Currys', 'Screwfix',
    'B&Q', 'Home Depot', 'Lowe', 'Walmart', 'Target', 'Costco', 'Best Buy', 'Rakuten', 'Alibaba', 'Mercari', 'Subito', 'Wallapop', 'Klarna', 'Scalapay', 'Tabaccheria', 'Tabacchi', 'Edicola', 'Cinesi', 'Bazar', 'Euro Shop',
    'Sephora', 'Douglas', 'Rossmann', 'DM Drogerie=dm drogerie|dm drogeriemarkt', 'Acqua e Sapone=acqua e sapone', 'Tigotà=tigota|tigotà', 'Yankee Candle', 'Pandora', 'Swarovski', 'Rituals', 'Lush', 'Body Shop',
  ],
  subscriptions: [
    'Netflix', 'Spotify', 'Apple Services=apple com bill|apple services|itunes|icloud', 'Google One=google one|google storage|youtube premium|youtube music|google youtubepremium', 'Disney Plus=disney plus|disney|disneyplus', 'Prime Video=prime video|amazon prime|amznprime|amzn digital|audible',
    'DAZN', 'NOW TV=now tv|nowtv', 'Sky', 'HBO', 'Paramount', 'Kindle Unlimited=kindle unlimited|amazon kindle', 'Adobe', 'Microsoft 365=microsoft 365|office 365|microsoft office|msbill', 'Dropbox', 'Notion', 'OpenAI=chatgpt|openai',
    'Anthropic=anthropic|claude ai|claude sub', 'GitHub', 'Canva', 'Duolingo', 'Patreon', 'Twitch', 'PlayStation Plus=playstation plus|ps plus|psn', 'Xbox Game Pass=xbox game pass|xbox live', 'Nintendo Online=nintendo online|nintendo switch online',
    'Tinder', 'Bumble', 'LinkedIn Premium=linkedin premium|linkedin', 'NordVPN', '1Password', 'LastPass', 'Medium', 'New York Times=new york times|nytimes', 'Substack', 'ExpressVPN', 'ProtonMail=proton', 'Evernote', 'Zoom', 'Slack',
    'Deezer', 'Tidal', 'Apple Music', 'Amazon Music', 'Crunchyroll', 'Mubi', 'Discovery Plus', 'Peacock', 'Hulu', 'Max', 'Strava', 'Headspace', 'Calm', 'Babbel', 'Coursera Plus', 'Masterclass', 'Skillshare', 'Telepass Pay',
  ],
  utilities: [
    'Enel', 'Plenitude=plenitude|eni plenitude', 'Edison', 'A2A', 'Hera', 'Iren', 'Acea', 'Sorgenia', 'E.ON=e on|eon', 'Illumia', 'Axpo', 'Octopus Energy=octopus energy', 'British Gas', 'EDF', 'Engie', 'Vattenfall', 'Naturgy', 'Iberdrola',
    'TIM=tim spa|telecom italia|tim', 'Vodafone', 'WindTre=windtre|wind tre|wind|3 italia', 'Iliad', 'Fastweb', 'Ho Mobile=ho mobile', 'Kena Mobile=kena', 'PosteMobile=postemobile|poste mobile', 'Very Mobile', 'Tiscali', 'Linkem',
    'O2', 'Three', 'EE', 'Orange', 'SFR', 'Bouygues', 'Free Mobile', 'Telekom', 'Swisscom', 'Sunrise', 'Salt', 'Telenor', 'Proximus', 'KPN', 'Ziggo', 'Telefonica=movistar|telefonica', 'Digi', 'Canone Rai=canone rai|rai canone|rai abbonamento',
    'Tari=tari|tassa rifiuti', 'Acquedotto', 'Gas Natural', 'Italgas', 'Bolletta=bolletta|bollette|utenza|utenze', 'Prodotti Servizi Windtre', 'Servizi Windtre',
  ],
  benefits: ['INPS=inps|inail|naspi|assegno unico|cassa integrazione', 'Pensione=pensione|pension payment|rente|kindergeld'],
  salary: ['Stipendio=stipendio|stipendi|salary|payroll|retribuzione|emolumenti|cedolino|busta paga|gehalt|salaire'],
  rent: ['Affitto=affitto|canone di locazione|canone locazione|locazione', 'Condominio=condominio|spese condominiali|amministratore', 'Rent=rent payment|monthly rent|rent', 'Miete', 'Loyer', 'Alquiler'],
  loans: ['Agos=agos|agos ducato', 'Findomestic', 'Compass', 'Santander Consumer', 'Prestito=prestito|finanziamento|rata mutuo|rata finanziamento|rate mutuo', 'Mutuo=mutuo', 'Loan=loan repayment|loan payment', 'Sella Personal Credit', 'Younited', 'Cofidis', 'Cetelem', 'Pagodil', 'Paypal Credit'],
  health: [
    'Farmacia=farmacia|farmacie|parafarmacia', 'Pharmacy=pharmacy|chemist', 'Apotheke', 'Boots', 'Lloyds Pharmacy=lloyds pharmacy', 'CVS', 'Walgreens', 'Ospedale', 'Clinica', 'Ambulatorio', 'Laboratorio Analisi=laboratorio analisi|analisi cliniche',
    'ASL=asl|ats|ticket sanitario', 'Dentista=dentista|studio dentistico|odontoiatr', 'Dottore=dott ssa|medico|studio medico|poliambulatorio', 'Fisioterapia=fisioterap|osteopata|chiropratic', 'Ottica=ottica|optician|specsavers|salmoiraghi', 'Doctolib', 'Centro Medico',
    'Fondazione Don Gnocchi', 'Humanitas', 'San Raffaele', 'Veterinario=veterinari|clinica veterinaria',
  ],
  fitness: ['Palestra=palestra|fitness|gym|crossfit', 'Yoga=yoga|pilates', 'Virgin Active', 'Anytime Fitness', 'McFit', 'Technogym', 'Urban Sports Club', 'Fitbit', 'Piscina', 'Sport Center=sport center|centro sportivo', 'Basic Fit=basic fit|basic-fit', 'Gympass', 'ClassPass', 'Peloton'],
  personal_care: ['Parrucchiere=parrucchier|hairdresser|friseur|coiffeur', 'Barbiere=barbiere|barber', 'Estetista=estetist|beauty center|centro estetico|nail', 'Spa=spa day|wellness|terme', 'Profumeria=profumeri|perfumery', 'Massaggi=massagg|massage'],
  entertainment: ['Cinema=cinema|uci cinemas|the space cinema|multisala', 'Teatro=teatro|theatre|theater', 'TicketOne', 'Ticketmaster', 'Eventbrite', 'Museo=museo|museum|mostra|galleria', 'Gardaland', 'Bowling', 'Steam', 'Epic Games', 'Google Play', 'Nintendo eShop=nintendo eshop', 'PlayStation Store=playstation store', 'Discoteca=discoteca|club', 'Concerto=concerto|concert|festival', 'Luna Park', 'Parco Divertimenti', 'Zoo', 'Acquario', 'Escape Room', 'Karaoke', 'Biglietteria', 'Vivaticket', 'DICE'],
  travel: [
    'Booking.com=booking com|booking', 'Airbnb', 'Expedia', 'Ryanair', 'EasyJet', 'Wizz Air=wizz air|wizzair', 'Vueling', 'Lufthansa', 'ITA Airways=ita airways|alitalia', 'Trivago', 'Kayak', 'Skyscanner', 'TripAdvisor', 'Hotel=hotel|hostel|b b|bed and breakfast|albergo',
    'Moby', 'Tirrenia', 'Grimaldi', 'GNV', 'Costa Crociere', 'MSC', 'Ferries', 'Aeroporto=aeroporto|airport', 'Hertz', 'Avis', 'Europcar', 'Sixt', 'Eurostar', 'Agenzia Viaggi=agenzia viaggi|viaggi', 'Edreams', 'Opodo', 'Hostelworld', 'Vacanze',
    'British Airways', 'Air France', 'KLM', 'Iberia', 'TAP Air', 'Swiss Air', 'Emirates', 'Turkish Airlines', 'Norwegian', 'SAS', 'Volotea', 'Air Dolomiti', 'Neos', 'Blue Panorama',
  ],
  insurance: ['Assicurazione=assicurazione|assicurazioni|polizza|assicura', 'Unipol', 'Generali', 'Allianz', 'AXA', 'Zurich', 'Reale Mutua=reale mutua', 'Linear', 'Genertel', 'Direct Line', 'Vittoria', 'Poste Vita', 'Cattolica', 'Insurance', 'Versicherung', 'Hdi', 'Sara Assicurazioni'],
  education: ['Università=universita|university|ateneo|politecnico|tasse universitarie', 'Scuola=scuola|school|asilo|nido|mensa scolastica|kindergarten', 'Udemy', 'Coursera', 'Libri=libri scolastici|libreria universitaria', 'Corso=corso di|course|lezioni|lezione', 'Accademia', 'Istituto', 'Iscrizione=iscrizione|tuition', 'Duolingo Plus'],
  gifts: ['Regalo=regalo|regali|gift|present', 'Fiori=fiori|fioraio|florist|interflora', 'Giocattoli=giocattoli|toys|toy', 'Lego', 'Bomboniere', 'Hallmark', 'Moonpig', 'Confetti', 'Pasticceria Regalo'],
  home: ['Ferramenta=ferramenta|hardware store', 'Casalinghi=casalinghi', 'Giardinaggio=giardinaggio|garden center|vivaio', 'Idraulico=idraulico|plumber', 'Elettricista=elettricista|electrician', 'Lavanderia=lavanderia|laundry|tintoria', 'Pulizie=pulizie|cleaning|domestic'],
  pets: ['Arcaplanet', 'Maxi Zoo=maxi zoo|maxizoo', 'Zooplus', 'Toelettatura=toelettatur|pet shop', 'Pet Store=pet store|petco|petsmart', 'Veterinario Animali'],
  donations: ['Donazione=donazione|donazioni|donation|offerta libera|charity', 'UNICEF', 'Emergency', 'AIRC', 'WWF', 'Croce Rossa=croce rossa|red cross', 'Medici Senza Frontiere=medici senza frontiere|msf', 'Save the Children', 'Greenpeace', 'Telethon', 'Amnesty'],
  fees: ['Commissioni=commissioni|commissione|spese tenuta conto|canone conto|canone carta|spese adue|spese e commissioni|fee|bank fee|account fee|annual fee|monthly fee|kontoführung|kontofuhrung|frais de tenue|gebuhr', 'Imposta di bollo=imposta di bollo|bollo|stamp duty|bolli', 'Interessi Passivi=interessi passivi|interest charged|overdraft', 'ATM Fee=atm fee|prelievo commissione'],
  taxes: ['Agenzia delle Entrate=agenzia delle entrate|f24|tributi|imposta|irpef|imu|tasi|bollo auto|tassa|acì=aci|tax payment|hmrc|irs'],
  cash: ['Prelievo=prelievo|prelievi|prelievo bancomat|prelievo contante|cash withdrawal|atm withdrawal|bancomat prelievo|cash at|geldautomat|retrait|retiro cajero|atm', 'Versamento Contanti=versamento contanti|cash deposit|cash in'],
  transfers: [
    'Giroconto=giroconto|giro conto', 'Revolut=revolut', 'To Pocket=to pocket|from pocket|pocket withdrawal|pocket transfer', 'Apple Pay Deposit=apple pay deposit|top up|topup|top-up|ricarica conto|ricarica carta|carica carta',
    'Addebito Carta di Credito=addebito saldo e c carta di credito|addebito carta di credito|saldo carta di credito|credit card payment|pagamento carta di credito|payment to card', 'Satispay', 'Wise=wise|transferwise', 'Transfer To=transfer to|transfer from|trasferimento a|trasferimento da|sent from revolut|to own account|own account|own transfer|between accounts',
  ],
};

/** Common words, weaker than a name. A trailing * means "starts with". */
export const WORDS = {
  groceries: ['supermercat*', 'alimentari', 'minimarket', 'mini market', 'ipermercat*', 'macelleri*', 'panificio', 'panetteria', 'fornaio', 'ortofrutta', 'fruttivendol*', 'pescheri*', 'salumeri*', 'gastronomia', 'groceries', 'grocery', 'supermarket', 'bakery', 'butcher', 'greengrocer', 'lebensmittel', 'supermarkt', 'backerei', 'baeckerei', 'boulangerie', 'epicerie', 'supermercado', 'panaderia', 'mercato', 'forno', 'discount', '?market', '?mercato'],
  dining: ['ristorant*', 'trattoria', 'osteria', 'pizzeria', 'pizza', 'sushi', 'kebab', 'burger', 'gelateria', 'gelato', 'caffe', 'cafe', 'coffee', 'caffetteria', 'pub', 'birreria', 'enoteca', 'paninoteca', 'tavola calda', 'rosticceria', 'pasticceria', 'restaurant', 'diner', 'bistro', 'brasserie', 'takeaway', 'take away', 'cocktail', 'wine bar', 'lunch', 'dinner', 'breakfast', 'bakery cafe', 'tea room', 'trattoria', 'bar', 'ristoro', 'braceria', 'hamburgeria', 'tavern*', 'cucina', 'food', 'delivery'],
  clothing: ['abbigliamento', 'boutique', 'calzature', 'scarpe', 'shoes', 'clothing', 'fashion', 'moda', 'intimo', 'lingerie', 'sartoria', 'tessuti'],
  transport: ['taxi', 'parcheggio', 'parking', 'sosta', 'biglietto', 'abbonamento bus', 'carburante', 'benzina', 'gasolio', 'diesel', 'rifornimento', 'autolinee', 'autobus', 'metropolitana', 'ferrovie', 'railway', 'train', 'treno', 'pedaggio', 'autostrada', 'noleggio', 'car rental', 'bike', 'scooter', 'monopattino', 'tram', 'bus', 'parkplatz', 'tankstelle', 'carburant', 'peage'],
  shopping: ['negozio', 'shop', 'store', 'outlet', 'online', 'acquisto', 'purchase', 'marketplace', 'magazzini', 'grandi magazzini', 'department store', 'bazar'],
  subscriptions: ['abbonamento', 'subscription', 'membership', 'premium', 'streaming', 'abo', 'abonnement', 'suscripcion'],
  utilities: ['utenza', 'bolletta', 'energia', 'elettricita', 'electricity', 'luce', 'gas', 'acqua', 'water', 'internet', 'telefono', 'telephone', 'mobile', 'cellulare', 'fibra', 'broadband', 'wifi', 'strom', 'wasser', 'heizung', 'electricite', 'rifiuti'],
  rent: ['affitto', 'pigione', 'canone mensile', 'rent'],
  loans: ['rata', 'rate', 'finanziamento', 'prestito', 'mutuo', 'loan', 'installment', 'instalment', 'kredit', 'credit rate', 'leasing'],
  health: ['farmaci', 'medic*', 'dottor*', 'visita', 'analisi', 'ticket', 'sanitaria', 'salute', 'health', 'clinic*', 'hospital', 'ospedal*', 'dental', 'dentist*', 'terapia', 'psicolog*', 'physio*', 'arzt', 'zahnarzt', 'medecin'],
  fitness: ['palestra', 'fitness', 'gym', 'yoga', 'pilates', 'nuoto', 'swimming', 'sport', 'calcio', 'tennis', 'padel', 'climbing'],
  personal_care: ['parrucch*', 'barbier*', 'estetic*', 'beauty', 'cosmetic*', 'profumeri*', 'manicure', 'unghie', 'salon', 'hair'],
  entertainment: ['cinema', 'teatro', 'concerto', 'museo', 'biglietti', 'spettacolo', 'evento', 'event', 'game', 'giochi', 'videogiochi', 'tempo libero', 'leisure', 'ticket one', 'ingresso', 'entry', 'discoteca', 'nightclub', 'bowling', 'karaoke'],
  travel: ['hotel', 'hostel', 'albergo', 'vacanz*', 'viaggi*', 'travel', 'flight', 'volo', 'airline', 'airways', 'airport', 'aeroporto', 'resort', 'camping', 'crociera', 'cruise', 'tour', 'excursion', 'escursione'],
  insurance: ['assicura*', 'polizza', 'insurance', 'versicherung', 'assurance', 'seguro', 'rca'],
  education: ['scuola', 'universit*', 'corso', 'course', 'lezion*', 'istruzione', 'school', 'tuition', 'iscrizione', 'esame', 'exam', 'libri', 'books', 'cancelleria'],
  gifts: ['regalo', 'regali', 'gift', 'present', 'fiori', 'compleanno', 'birthday', 'bomboniera'],
  home: ['ferramenta', 'casalinghi', 'arredamento', 'mobili', 'furniture', 'giardino', 'garden', 'bricolage', 'diy', 'lavanderia', 'tintoria'],
  pets: ['veterinari*', 'toelettatura', 'animali', 'pet', 'cane', 'gatto', 'dog', 'cat food'],
  donations: ['donazion*', 'donation', 'beneficenza', 'charity', 'offerta', 'onlus', 'fondazione'],
  fees: ['commission*', 'spese', 'canone', 'fee', 'fees', 'bollo', 'bolli', 'interessi passivi', 'penale', 'penalty', 'mora', 'charge', 'charges'],
  taxes: ['imposta', 'imposte', 'tassa', 'tasse', 'tributo', 'tributi', 'f24', 'tax', 'taxes', 'irpef', 'imu', 'steuer', 'impot'],
  cash: ['prelievo', 'prelievi', 'bancomat', 'contanti', 'atm', 'cash', 'bargeld', 'geldautomat', 'retrait', 'retiro'],
  transfers: ['bonifico', 'giroconto', 'trasferimento', 'transfer', 'ricarica', 'top up', 'topup', 'pocket', 'overschrijving', 'uberweisung', 'virement', 'transferencia', 'settlement', 'regolamento', 'sepa credit transfer', 'wire transfer', 'faster payment', 'ach credit', 'ach debit', 'instant transfer'],
  // money in
  salary: ['stipendio', 'stipendi', 'salary', 'payroll', 'retribuzione', 'emolument*', 'cedolino', 'busta paga', 'lohn', 'gehalt', 'salaire', 'salario', 'sueldo', 'wages', 'paycheck', 'paycheque', 'nomina', 'compenso', 'competenze', 'lavoro dipendente', 'employer'],
  benefits: ['pension*', 'inps', 'inail', 'assegno', 'bonus', 'sussidio', 'indennit*', 'naspi', 'cassa integrazione', 'benefit*', 'allowance', 'rente', 'kindergeld', 'wohngeld', 'agenzia entrate', 'contributo', 'sostegno'],
  refunds: ['rimbors*', 'refund', 'storno', 'reversal', 'cashback', 'chargeback', 'resi', 'return', 'erstattung', 'remboursement', 'reembolso', 'credit note', 'nota di credito', 'rettifica', 'restituzione', 'rimborso'],
  interest: ['interess*', 'interest', 'dividend*', 'cedola', 'coupon', 'zinsen', 'cashback interest'],
  gifts_in: ['regalo ricevuto', 'gift from'],
  freelance: ['fattura', 'invoice', 'rechnung', 'facture', 'freelance', 'consulenza', 'consulting', 'prestazione', 'parcella'],
};

/** What banks call their own categories (folded text, without punctuation) and what kind of spending that is; null says "no information". */
export const BANK_CATEGORIES = [
  // Italian
  ['generi alimentari e supermercato', 'groceries'], ['generi alimentari', 'groceries'], ['supermercato', 'groceries'], ['alimentari', 'groceries'], ['spesa', 'groceries'],
  ['ristoranti e bar', 'dining'], ['ristoranti', 'dining'], ['bar e ristoranti', 'dining'], ['ristorazione', 'dining'], ['bar', 'dining'],
  ['abbigliamento e accessori', 'clothing'], ['abbigliamento', 'clothing'], ['calzature', 'clothing'], ['shopping e abbigliamento', 'clothing'],
  ['trasporti noleggi taxi e parcheggi', 'transport'], ['trasporti varie', 'transport'], ['trasporti', 'transport'], ['carburante', 'transport'], ['auto e moto', 'transport'], ['auto', 'transport'], ['mezzi pubblici', 'transport'], ['trasporto', 'transport'],
  ['tempo libero varie', 'entertainment'], ['tempo libero', 'entertainment'], ['cultura e spettacolo', 'entertainment'], ['sport e hobby', 'fitness'], ['sport', 'fitness'], ['palestra', 'fitness'], ['hobby', 'entertainment'],
  ['viaggi e vacanze', 'travel'], ['viaggi', 'travel'], ['vacanze', 'travel'], ['alberghi', 'travel'],
  ['cura della persona', 'personal_care'], ['bellezza', 'personal_care'], ['salute e benessere', 'health'], ['salute', 'health'], ['farmacia', 'health'], ['spese mediche', 'health'], ['medico', 'health'],
  ['hi tech e informatica', 'shopping'], ['elettronica e informatica', 'shopping'], ['hi tech', 'shopping'], ['shopping', 'shopping'], ['acquisti online', 'shopping'], ['acquisti', 'shopping'], ['casa e arredamento', 'home'], ['casa', 'home'], ['arredamento', 'home'], ['bricolage', 'home'],
  ['utenze e bollette', 'utilities'], ['utenze', 'utilities'], ['bollette', 'utilities'], ['cellulare', 'utilities'], ['telefono e internet', 'utilities'], ['telefonia', 'utilities'], ['energia', 'utilities'], ['luce e gas', 'utilities'],
  ['rate mutuo e finanziamento', 'loans'], ['mutuo e finanziamenti', 'loans'], ['finanziamenti', 'loans'], ['mutuo', 'rent'], ['affitto', 'rent'], ['affitto e condominio', 'rent'], ['condominio', 'rent'],
  ['imposte bolli e commissioni', 'fees'], ['commissioni e spese bancarie', 'fees'], ['spese bancarie', 'fees'], ['commissioni', 'fees'], ['imposte e tasse', 'taxes'], ['tasse', 'taxes'], ['imposte', 'taxes'],
  ['prelievi', 'cash'], ['prelievo contante', 'cash'], ['contanti', 'cash'],
  ['assicurazioni', 'insurance'], ['istruzione', 'education'], ['scuola e istruzione', 'education'], ['formazione', 'education'], ['regali e donazioni', 'gifts'], ['regali', 'gifts'], ['beneficenza', 'donations'], ['animali domestici', 'pets'], ['animali', 'pets'], ['figli', 'kids'], ['bambini', 'kids'],
  ['abbonamenti', 'subscriptions'], ['servizi digitali', 'subscriptions'],
  ['stipendio e pensione', 'salary'], ['stipendio', 'salary'], ['stipendi e pensioni', 'salary'], ['pensione', 'benefits'], ['sussidi', 'benefits'],
  ['rimborsi spese e storni', 'refunds'], ['rimborsi', 'refunds'], ['storni', 'refunds'], ['interessi', 'interest'],
  ['giroconti', 'transfers'], ['trasferimenti', 'transfers'], ['carta di credito', 'transfers'], ['addebito mia carta di credito', 'transfers'],
  ['altre uscite', null], ['addebiti vari', null], ['bonifici ricevuti', null], ['bonifici', null], ['altre entrate', null], ['entrate', null], ['uscite', null], ['varie', null], ['non categorizzato', null], ['altro', null],
  // English
  ['groceries', 'groceries'], ['grocery', 'groceries'], ['supermarkets', 'groceries'], ['food and groceries', 'groceries'], ['food shops', 'groceries'],
  ['restaurants and bars', 'dining'], ['restaurants', 'dining'], ['eating out', 'dining'], ['dining', 'dining'], ['dining out', 'dining'], ['cafes', 'dining'], ['coffee shops', 'dining'], ['fast food', 'dining'], ['food and drink', 'dining'], ['takeaway', 'dining'],
  ['clothing', 'clothing'], ['clothes', 'clothing'], ['clothing and shoes', 'clothing'], ['fashion', 'clothing'], ['apparel', 'clothing'],
  ['transport', 'transport'], ['transportation', 'transport'], ['public transport', 'transport'], ['fuel', 'transport'], ['gas stations', 'transport'], ['taxi', 'transport'], ['car', 'transport'], ['parking', 'transport'], ['auto and transport', 'transport'],
  ['entertainment', 'entertainment'], ['leisure', 'entertainment'], ['fun', 'entertainment'], ['games', 'entertainment'], ['movies and music', 'entertainment'],
  ['travel', 'travel'], ['holidays', 'travel'], ['hotels', 'travel'], ['trips', 'travel'], ['vacation', 'travel'],
  ['health', 'health'], ['healthcare', 'health'], ['medical', 'health'], ['pharmacy', 'health'], ['fitness', 'fitness'], ['gym', 'fitness'], ['sports', 'fitness'], ['personal care', 'personal_care'], ['beauty', 'personal_care'], ['hair and beauty', 'personal_care'],
  ['shopping', 'shopping'], ['general', 'shopping'], ['online shopping', 'shopping'], ['electronics', 'shopping'], ['home', 'home'], ['household', 'home'], ['home improvement', 'home'], ['furniture', 'home'],
  ['bills', 'utilities'], ['bills and utilities', 'utilities'], ['utilities', 'utilities'], ['phone', 'utilities'], ['internet', 'utilities'], ['mobile', 'utilities'], ['energy', 'utilities'],
  ['subscriptions', 'subscriptions'], ['subscription', 'subscriptions'], ['streaming', 'subscriptions'], ['software', 'subscriptions'],
  ['rent', 'rent'], ['mortgage', 'rent'], ['housing', 'rent'], ['loans', 'loans'], ['loan payments', 'loans'], ['debt', 'loans'],
  ['insurance', 'insurance'], ['education', 'education'], ['school', 'education'], ['gifts', 'gifts'], ['gifts and donations', 'gifts'], ['charity', 'donations'], ['donations', 'donations'], ['pets', 'pets'], ['kids', 'kids'], ['children', 'kids'],
  ['fees', 'fees'], ['bank fees', 'fees'], ['bank charges', 'fees'], ['fees and charges', 'fees'], ['taxes', 'taxes'], ['tax', 'taxes'], ['cash', 'cash'], ['cash withdrawals', 'cash'], ['atm', 'cash'], ['withdrawals', 'cash'],
  ['salary', 'salary'], ['income', null], ['wages', 'salary'], ['pay', 'salary'], ['refunds', 'refunds'], ['interest', 'interest'], ['dividends', 'interest'], ['benefits', 'benefits'], ['pension', 'benefits'],
  ['transfers', 'transfers'], ['transfer', 'transfers'], ['payment', 'transfers'], ['payments', 'transfers'], ['card payment', null], ['general', null], ['other', null], ['uncategorised', null], ['uncategorized', null], ['miscellaneous', null], ['misc', null], ['unknown', null],
  // German
  ['lebensmittel', 'groceries'], ['supermarkt', 'groceries'], ['restaurants und cafes', 'dining'], ['gastronomie', 'dining'], ['kleidung', 'clothing'], ['mode', 'clothing'], ['verkehr', 'transport'], ['mobilitat', 'transport'], ['auto und verkehr', 'transport'], ['tanken', 'transport'],
  ['freizeit', 'entertainment'], ['unterhaltung', 'entertainment'], ['reisen', 'travel'], ['urlaub', 'travel'], ['gesundheit', 'health'], ['drogerie', 'personal_care'], ['wohnen', 'rent'], ['miete', 'rent'], ['versicherungen', 'insurance'], ['versicherung', 'insurance'],
  ['bildung', 'education'], ['geschenke', 'gifts'], ['gebuhren', 'fees'], ['steuern', 'taxes'], ['bargeld', 'cash'], ['einkommen', null], ['gehalt', 'salary'], ['lohn und gehalt', 'salary'], ['sonstiges', null], ['abonnements', 'subscriptions'], ['telekommunikation', 'utilities'], ['nebenkosten', 'utilities'],
  // French / Spanish / Portuguese / Dutch
  ['alimentation', 'groceries'], ['supermarche', 'groceries'], ['courses', 'groceries'], ['restauration', 'dining'], ['restaurants et bars', 'dining'], ['vetements', 'clothing'], ['transports', 'transport'], ['loisirs', 'entertainment'], ['voyages', 'travel'], ['sante', 'health'], ['logement', 'rent'], ['loyer', 'rent'], ['assurances', 'insurance'], ['impots', 'taxes'], ['frais bancaires', 'fees'], ['retrait', 'cash'], ['salaire', 'salary'], ['abonnements et services', 'subscriptions'],
  ['alimentacion', 'groceries'], ['supermercados', 'groceries'], ['restaurantes', 'dining'], ['ropa', 'clothing'], ['transporte', 'transport'], ['ocio', 'entertainment'], ['viajes', 'travel'], ['salud', 'health'], ['vivienda', 'rent'], ['alquiler', 'rent'], ['seguros', 'insurance'], ['impuestos', 'taxes'], ['comisiones', 'fees'], ['nomina', 'salary'],
  ['supermercado', 'groceries'], ['alimentacao', 'groceries'], ['restaurantes e bares', 'dining'], ['vestuario', 'clothing'], ['transportes', 'transport'], ['lazer', 'entertainment'], ['saude', 'health'], ['habitacao', 'rent'], ['seguros e proteccao', 'insurance'],
  ['boodschappen', 'groceries'], ['horeca', 'dining'], ['kleding', 'clothing'], ['vervoer', 'transport'], ['vrije tijd', 'entertainment'], ['gezondheid', 'health'], ['wonen', 'rent'], ['verzekeringen', 'insurance'], ['belastingen', 'taxes'], ['salaris', 'salary'],
];

// ---------------------------------------------------------------------------------------------------------------------------------
// Compiling the lists
// ---------------------------------------------------------------------------------------------------------------------------------

/** Lower case, no accents or apostrophes, every run of other characters a single space. */
export const normalize = (s) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .replace(/['’`]/g, '')
    .replace(/[^a-z0-9*]+/g, ' ')
    .trim();

const phraseOf = (p) => normalize(p.replace(/&/g, ' and ')).replace(/\*/g, '');

// Names and words that are also ordinary words or other things: they are a weak sign, so the line is marked to be checked.
const WEAK_BRANDS = new Set(['Max', 'Sky', 'Salt', 'Three', 'EE', 'O2', 'Orange', 'Gap', 'Next', 'Action', 'Target', 'Lime', 'Bird', 'Voi', 'Tier', 'Wish', 'Bolt', 'Metro', 'Taxi', 'Quick', 'Elite', 'Prix', 'Cos', 'Calm', 'Slack', 'Zoom', 'Medium', 'Notion', 'Lowe', 'Digi', 'Expert', 'Norma', 'Casino Supermarche', 'Free Mobile', 'Simply', 'Sigma', 'Tiger', 'Enjoy', 'MSC', 'SAS', 'Diesel', 'Guess', 'Levi', 'Wise', 'Shell', 'Kiko', 'Pandora', 'Weekday', 'Monki', 'Arket', 'Cetelem', 'Compass', 'Superstore', 'Linear', 'Vittoria', 'Spa', 'Yoga', 'Lego', 'Lush', 'Rituals', 'Douglas', 'Bazar', 'Euro Shop', 'Sport Center', 'Hotel', 'Tabacchi', 'Edicola', 'Libreria', 'Cartoleria', 'Metro Cash', 'Dott', 'HEMA', 'Rent']);
const WEAK_WORDS = new Set(['bar', 'food', 'delivery', 'cucina', 'shop', 'store', 'online', 'acquisto', 'purchase', 'market', 'mercato', 'sport', 'ticket', 'rate', 'spese', 'canone', 'acqua', 'luce', 'mobile', 'event', 'evento', 'game', 'entry', 'tour', 'pet', 'offerta', 'hair', 'salon', 'bonus', 'contributo', 'sostegno', 'nomina', 'return', 'resi', 'rettifica', 'coupon', 'mora', 'charge', 'charges', 'gas', 'fee', 'fees', 'rent', 'present', 'gift', 'cash', 'transfer', 'pocket', 'settlement', 'regolamento', 'tax', 'taxes', 'water', 'telephone', 'train', 'bus', 'tram', 'parking', 'diesel', 'scooter', 'bike', 'discount', 'forno', 'cafe', 'coffee', 'pub', 'lunch', 'dinner', 'breakfast', 'general', 'premium', 'abo', 'moda', 'tessuti', 'visita', 'analisi', 'salute', 'health', 'giochi', 'ingresso', 'internet', 'energia', 'strom']);

/** brandIndex: first word -> [{ label, name, phrase, weak }] ; wordStems: [{ label, stem, weak }] ; wordPhrases: first word -> [...] */
function compile() {
  const brandIndex = new Map();
  const wordIndex = new Map();
  const stems = [];
  const add = (map, key, entry) => {
    const list = map.get(key) ?? [];
    list.push(entry);
    map.set(key, list);
  };
  for (const [label, entries] of Object.entries(BRANDS)) {
    for (const raw of entries) {
      const [display, alt] = raw.includes('=') ? raw.split('=') : [raw, raw];
      const weak = alt.startsWith('?') || WEAK_BRANDS.has(display);
      for (const p of alt.replace(/^\?/, '').split('|')) {
        const phrase = normalize(p.replace(/&/g, ' and '));
        if (!phrase) continue;
        // "h&m" is both "h and m" and "h m"
        for (const variant of new Set([phrase, normalize(p)])) {
          if (variant) add(brandIndex, variant.split(' ')[0], { label, name: display, phrase: variant, weak });
        }
      }
    }
  }
  for (const [label, entries] of Object.entries(WORDS)) {
    for (const raw of entries) {
      const text = raw.replace(/^\?/, '');
      const weak = raw.startsWith('?') || WEAK_WORDS.has(normalize(text.replace(/\*$/, '')));
      if (text.endsWith('*')) stems.push({ label, stem: normalize(text.slice(0, -1)), weak });
      else add(wordIndex, normalize(text).split(' ')[0], { label, phrase: normalize(text), weak });
    }
  }
  return { brandIndex, wordIndex, stems };
}
export const INDEX = compile();

/** The bank-category table as a Map from folded text to a label (or null). */
export const BANK_MAP = new Map(BANK_CATEGORIES.map(([phrase, label]) => [normalize(phrase), label]));
