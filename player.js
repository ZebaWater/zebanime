// player.js

const ADJ = [
  "Soggy","Crusty","Wobbly","Sweaty","Greasy","Moldy","Funky","Lumpy",
  "Goofy","Slimy","Chunky","Mushy","Dizzy","Stinky","Puffy","Dopey",
  "Wacky","Boggy","Fluffy","Droopy","Jiggly","Clumsy","Gassy",
  "Floppy","Sloppy","Zesty","Cheesy","Toasty","Bratty","Nerdy",
  "Derpy","Frumpy","Grumpy","Bumbling","Babbling","Stumbling","Fumbling","Mumbling"
];

const NOUN = [
  "Noodle","Dumpling","Cabbage","Pickle","Biscuit","Meatball","Waffle","Potato",
  "Sausage","Onion","Radish","Turnip","Peanut","Mushroom","Pretzel","Crouton",
  "Nugget","Goblin","Gremlin","Toad","Slug","Hamster","Pigeon","Walrus",
  "Narwhal","Platypus","Blobfish","Manatee","Armadillo","Warthog","Sloth","Ferret",
  "Sock","Sandal","Spatula","Stapler","Blanket","Pillow","Doorknob","Bucket"
];

export function generateName() {
  const a = ADJ[Math.floor(Math.random() * ADJ.length)];
  const n = NOUN[Math.floor(Math.random() * NOUN.length)];
  return `${a}${n}`;
}

function generateUID() {
  return Math.random().toString(36).slice(2, 10) +
         Math.random().toString(36).slice(2, 10);
}

export function saveName(name) {
  localStorage.setItem("ad_name", name);
}

export function getPlayer() {
  let uid  = localStorage.getItem("ad_uid");
  let name = localStorage.getItem("ad_name");

  if (!uid)  { uid  = generateUID();   localStorage.setItem("ad_uid", uid); }
  if (!name) { name = generateName();  localStorage.setItem("ad_name", name); }

  return { uid, name };
}

export function generateRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}