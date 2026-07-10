// The mascot's motivational arsenal — stoics, warriors and David Goggins.
// Short on purpose: they live inside a pixel speech bubble.
// `mood` drives the mascot's face: angry = drill sergeant, think = philosopher,
// focus = discipline, happy/hyped = celebration, sad = memento mori.

import type { MascotMood } from '../components/Mascot';

export interface Quote {
  pt: string;
  en: string;
  author: string;
  /** localized author name when it differs from the PT one */
  authorEn?: string;
  mood: MascotMood;
}

export const QUOTES: Quote[] = [
  // David Goggins
  { pt: 'Quando você acha que acabou, você só usou 40% do que tem.', en: "When you think you're done, you're only at 40% of what you've got.", author: 'David Goggins', mood: 'angry' },
  { pt: 'Ninguém vai vir te salvar. Levanta e vai.', en: 'No one is coming to save you. Get up and go.', author: 'David Goggins', mood: 'angry' },
  { pt: 'Cale a mente. Ela desiste antes do corpo.', en: 'Callous your mind. It quits before the body does.', author: 'David Goggins', mood: 'angry' },
  { pt: 'Quem vai carregar os barcos?', en: 'Who is gonna carry the boats?', author: 'David Goggins', mood: 'angry' },
  { pt: 'Conforto é uma prisão de porta aberta.', en: 'Comfort is a prison with an open door.', author: 'David Goggins', mood: 'focus' },
  { pt: 'Faça algo que odeia todo dia. Cresça.', en: 'Do something you hate every day. Grow.', author: 'David Goggins', mood: 'angry' },
  { pt: 'A motivação acaba. A disciplina fica.', en: 'Motivation runs out. Discipline stays.', author: 'David Goggins', mood: 'focus' },
  { pt: 'Stay hard.', en: 'Stay hard.', author: 'David Goggins', mood: 'angry' },

  // Marco Aurélio
  { pt: 'Você tem poder sobre sua mente, não sobre os eventos.', en: 'You have power over your mind — not outside events.', author: 'Marco Aurélio', authorEn: 'Marcus Aurelius', mood: 'think' },
  { pt: 'O que impede a ação, vira a ação. O obstáculo é o caminho.', en: 'The impediment to action advances action. The obstacle is the way.', author: 'Marco Aurélio', authorEn: 'Marcus Aurelius', mood: 'focus' },
  { pt: 'Pare de discutir o que é um bom homem. Seja um.', en: 'Waste no more time arguing what a good man should be. Be one.', author: 'Marco Aurélio', authorEn: 'Marcus Aurelius', mood: 'angry' },
  { pt: 'Levanta e faz o trabalho de ser humano.', en: 'Get up and do the work of a human being.', author: 'Marco Aurélio', authorEn: 'Marcus Aurelius', mood: 'focus' },
  { pt: 'Muito pouco é necessário pra uma vida feliz.', en: 'Very little is needed to make a happy life.', author: 'Marco Aurélio', authorEn: 'Marcus Aurelius', mood: 'happy' },

  // Sêneca
  { pt: 'Sorte é o encontro da preparação com a oportunidade.', en: 'Luck is what happens when preparation meets opportunity.', author: 'Sêneca', authorEn: 'Seneca', mood: 'think' },
  { pt: 'Não é que temos pouco tempo. É que desperdiçamos muito.', en: "It's not that we have little time — we waste a lot of it.", author: 'Sêneca', authorEn: 'Seneca', mood: 'sad' },
  { pt: 'Sofremos mais na imaginação do que na realidade.', en: 'We suffer more in imagination than in reality.', author: 'Sêneca', authorEn: 'Seneca', mood: 'think' },
  { pt: 'Enquanto adiamos, a vida passa.', en: 'While we postpone, life speeds by.', author: 'Sêneca', authorEn: 'Seneca', mood: 'sad' },
  { pt: 'Difícil não é porque não ousamos? Ousando, fica fácil.', en: "It's not because things are hard that we don't dare. We don't dare, so they're hard.", author: 'Sêneca', authorEn: 'Seneca', mood: 'focus' },

  // Epicteto
  { pt: 'Primeiro diga a si mesmo o que quer ser. Depois faça o que precisa.', en: 'First say to yourself what you would be; then do what you have to do.', author: 'Epicteto', authorEn: 'Epictetus', mood: 'focus' },
  { pt: 'Não explique sua filosofia. Incorpore-a.', en: "Don't explain your philosophy. Embody it.", author: 'Epicteto', authorEn: 'Epictetus', mood: 'focus' },
  { pt: 'Nenhum homem é livre se não é senhor de si mesmo.', en: 'No man is free who is not master of himself.', author: 'Epicteto', authorEn: 'Epictetus', mood: 'think' },

  // Nietzsche
  { pt: 'Quem tem um porquê enfrenta quase qualquer como.', en: 'He who has a why can bear almost any how.', author: 'Nietzsche', mood: 'think' },
  { pt: 'O que não me mata me fortalece.', en: 'What does not kill me makes me stronger.', author: 'Nietzsche', mood: 'angry' },

  // Bruce Lee
  { pt: 'Não temo quem treinou 10.000 chutes. Temo quem treinou um chute 10.000 vezes.', en: 'I fear not the man who practiced 10,000 kicks once, but the one who practiced one kick 10,000 times.', author: 'Bruce Lee', mood: 'focus' },
  { pt: 'Não deseje uma vida fácil. Deseje força pra aguentar uma difícil.', en: "Don't pray for an easy life. Pray for the strength to endure a difficult one.", author: 'Bruce Lee', mood: 'focus' },

  // Muhammad Ali
  { pt: 'Sofra agora e viva o resto da vida como campeão.', en: 'Suffer now and live the rest of your life as a champion.', author: 'Muhammad Ali', mood: 'hyped' },
  { pt: 'Não conte os dias. Faça os dias contarem.', en: "Don't count the days. Make the days count.", author: 'Muhammad Ali', mood: 'happy' },

  // Sun Tzu / Musashi / Confúcio
  { pt: 'Toda batalha é vencida antes de ser lutada.', en: 'Every battle is won before it is fought.', author: 'Sun Tzu', mood: 'think' },
  { pt: 'Hoje, vença quem você foi ontem.', en: 'Today, defeat the you of yesterday.', author: 'Miyamoto Musashi', mood: 'focus' },
  { pt: 'Não importa a lentidão, desde que você não pare.', en: "It doesn't matter how slowly you go, as long as you don't stop.", author: 'Confúcio', authorEn: 'Confucius', mood: 'happy' },
  { pt: 'Quem move montanhas começa carregando pedrinhas.', en: 'The man who moves a mountain begins by carrying small stones.', author: 'Confúcio', authorEn: 'Confucius', mood: 'think' },

  // Aristóteles / Da Vinci
  { pt: 'Somos o que fazemos repetidamente. Excelência é hábito.', en: 'We are what we repeatedly do. Excellence is a habit.', author: 'Aristóteles', authorEn: 'Aristotle', mood: 'focus' },
  { pt: 'Saber não basta; é preciso aplicar. Querer não basta; é preciso fazer.', en: 'Knowing is not enough; we must apply. Willing is not enough; we must do.', author: 'Da Vinci', mood: 'focus' },

  // Kobe / esporte
  { pt: 'Descansar no fim, não no meio.', en: 'Rest at the end, not in the middle.', author: 'Kobe Bryant', mood: 'angry' },
  { pt: 'O trabalho vence o talento quando o talento não trabalha.', en: 'Hard work beats talent when talent fails to work hard.', author: 'Kevin Durant', mood: 'focus' },
  { pt: 'Você erra 100% dos chutes que não dá.', en: "You miss 100% of the shots you don't take.", author: 'Wayne Gretzky', mood: 'happy' },

  // builders
  { pt: 'A melhor forma de prever o futuro é construí-lo.', en: 'The best way to predict the future is to build it.', author: 'Alan Kay', mood: 'hyped' },
  { pt: 'Feito é melhor que perfeito.', en: 'Done is better than perfect.', author: 'Sheryl Sandberg', mood: 'happy' },
  { pt: 'Seu tempo é limitado. Não o gaste vivendo a vida dos outros.', en: "Your time is limited. Don't waste it living someone else's life.", author: 'Steve Jobs', mood: 'think' },
  { pt: 'A pessoa que diz que não pode ser feito não deve interromper quem está fazendo.', en: 'The person who says it cannot be done should not interrupt the person doing it.', author: 'Provérbio chinês', authorEn: 'Chinese proverb', mood: 'hyped' },
  { pt: 'Comece onde está. Use o que tem. Faça o que pode.', en: 'Start where you are. Use what you have. Do what you can.', author: 'Arthur Ashe', mood: 'happy' },

  // grind
  { pt: 'Disciplina é escolher o que você quer MAIS em vez do que quer agora.', en: 'Discipline is choosing what you want most over what you want now.', author: 'Abraham Lincoln', mood: 'focus' },
  { pt: 'Um dia, ou dia um. Você decide.', en: 'One day, or day one. You decide.', author: '—', mood: 'hyped' },
  { pt: 'O melhor momento pra plantar uma árvore foi há 20 anos. O segundo melhor é agora.', en: 'The best time to plant a tree was 20 years ago. The second best is now.', author: 'Provérbio chinês', authorEn: 'Chinese proverb', mood: 'think' },
  { pt: 'Não pare quando estiver cansado. Pare quando terminar.', en: "Don't stop when you're tired. Stop when you're done.", author: '—', mood: 'angry' },
  { pt: 'Grandes coisas nunca vêm de zonas de conforto.', en: 'Great things never came from comfort zones.', author: '—', mood: 'focus' },
  { pt: 'Se fosse fácil, todo mundo faria.', en: 'If it were easy, everyone would do it.', author: '—', mood: 'angry' },
  { pt: 'A dor de hoje é a força de amanhã.', en: "Today's pain is tomorrow's strength.", author: '—', mood: 'focus' },
  { pt: 'Foco no passo. A montanha se resolve sozinha.', en: 'Focus on the step. The mountain takes care of itself.', author: '—', mood: 'think' },
  { pt: 'Você não precisa de mais tempo. Precisa de mais foco.', en: "You don't need more time. You need more focus.", author: '—', mood: 'focus' },
  { pt: 'Termina o que começou.', en: 'Finish what you started.', author: '—', mood: 'angry' },
];

export function randomQuote(): Quote {
  return QUOTES[Math.floor(Math.random() * QUOTES.length)];
}
