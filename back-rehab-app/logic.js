// Pure logic for the marathon section and the exercise swap. No DOM, no network: the app
// calls these with the data it already holds, and program-source/test_logic.mjs runs them
// under Node. Dates are "YYYY-MM-DD" strings in the phone's local time throughout.
var RL = (function(){

  function dayNum(s){ var p=s.split("-"); return Date.UTC(+p[0], +p[1]-1, +p[2])/86400000; }
  function addDays(s, n){ var d=new Date((dayNum(s)+n)*86400000); return d.toISOString().slice(0,10); }
  function round5(v){ return Math.max(5, Math.round(v/5)*5); }

  // The plan week containing `date`, or null before week 1 / after race week.
  function weekOf(plan, date){
    var i=Math.floor((dayNum(date)-dayNum(plan.start_date))/7);
    return (i>=0 && i<plan.weeks.length) ? plan.weeks[i] : null;
  }
  function weekEnd(wk){ return addDays(wk.start, 6); }
  function daysBetween(a, b){ return dayNum(b)-dayNum(a); }
  // Monday = 0 ... Sunday = 6
  function dow(date){ return (((dayNum(date)+3)%7)+7)%7; }

  function slotText(plan, wk, slot){
    if(slot==="E") return wk.e_text || plan.text.E;
    if(slot==="Q") return wk.q_text || plan.text[wk.q] || plan.text.E;
    if(slot==="L") return wk.l_text || plan.text[wk.l||"L"];
    if(slot==="RACE") return plan.race+". Run-walk 9:1 from the start.";
    return "";
  }
  function planned(wk, slot){ return slot==="RACE" ? null : wk[slot]; }
  function slotsOf(wk){ return wk.L==null ? ["E","Q","RACE"] : ["E","Q","L"]; }

  // Which planned run each logged run counts as. A slot the user picked always wins.
  // Otherwise the longest run of at least half the planned long run is the long run, and
  // the rest fill E then Q in date order. A run under half of the slot it would take is
  // an extra: a 10 min shakeout must never use up the long run.
  // Returns {byId: {runId: slot}, done: {slot: run}}.
  function assignWeek(runs, wk, raceDate){
    var inWeek=runs.filter(function(r){ return r.run_date>=wk.start && r.run_date<=weekEnd(wk); });
    var byId={}, done={}, slots=slotsOf(wk);
    inWeek.forEach(function(r){
      if(r.slot){ byId[r.id]=r.slot; if(r.slot!=="extra" && !done[r.slot]) done[r.slot]=r; }
    });
    var free=inWeek.filter(function(r){ return !r.slot; });
    if(slots.indexOf("RACE")>=0 && !done.RACE){
      free=free.filter(function(r){
        if(r.run_date===raceDate && !done.RACE){ byId[r.id]="RACE"; done.RACE=r; return false; }
        return true;
      });
    }
    if(slots.indexOf("L")>=0 && !done.L){
      var longest=null;
      free.forEach(function(r){ if(!longest || Number(r.duration_min)>Number(longest.duration_min)) longest=r; });
      if(longest && Number(longest.duration_min)>=0.5*wk.L){
        byId[longest.id]="L"; done.L=longest;
        free=free.filter(function(r){ return r!==longest; });
      }
    }
    free.slice().sort(function(a,b){ return a.run_date<b.run_date?-1:(a.run_date>b.run_date?1:a.id-b.id); })
      .forEach(function(r){
        var s=null;
        ["E","Q"].forEach(function(x){ if(!s && !done[x] && Number(r.duration_min)>=0.5*wk[x]) s=x; });
        if(s){ done[s]=r; byId[r.id]=s; } else byId[r.id]="extra";
      });
    return { byId:byId, done:done };
  }

  // Days since the last Amber or Red anywhere (check-in, gym session, run). `events` is a
  // list of {date, light}. With no bad day on record the gate is simply open.
  function quietDays(today, events){
    var last=null;
    events.forEach(function(e){
      if((e.light==="amber"||e.light==="red") && e.date<=today && (!last || e.date>last)) last=e.date;
    });
    return last ? daysBetween(last, today) : 999;
  }

  // Today's version of one planned run, after the back has had its say.
  //   o = {plan, wk, slot, light: today's check-in light or null, legs: bool,
  //        stage: the FLARE stage object (with .run) or null, quiet: quietDays()}
  // Order of precedence: Red / leg symptoms, then the flare ladder, then Amber, then the
  // intensity gate. Each step can only make the run smaller or easier, never bigger.
  function prescribe(o){
    var wk=o.wk, slot=o.slot;
    var base=planned(wk, slot);
    var out={ slot:slot, min:base, text:slotText(o.plan, wk, slot), blocked:false, reason:"",
              walkrun:false, quality: slot==="Q" ? !!wk.qq : (slot==="L" ? !!wk.lq : false) };
    var easyText = slot==="L" ? (wk.L>=120 ? o.plan.text.L_runwalk : o.plan.text.L) : o.plan.text.E;

    if(o.light==="red" || o.legs){
      out.blocked=true; out.min=0; out.quality=false;
      out.reason = slot==="RACE"
        ? "Red this morning or symptoms below the knee: do not start."
        : "Red this morning or symptoms below the knee: no run today. Walk only.";
      return out;
    }
    var r=o.stage && o.stage.run;
    if(r){
      out.quality=false;
      if(r.max===0){ out.blocked=true; out.min=0; out.reason="Flare stage "+o.stage.t+": "+r.text; return out; }
      if(r.walkrun){
        out.walkrun=true; out.min=Math.min(r.max, base||r.max); out.text=r.text;
        out.reason="Flare stage "+o.stage.t+": walk-run replaces this run.";
        return out;
      }
      if(base!=null){
        out.min=round5(base*r.pct/100);
        if(r.max) out.min=Math.min(out.min, r.max);
      }
      out.text=easyText;
      out.reason="Flare stage "+o.stage.t+": "+r.text;
    }
    if(o.light==="amber"){
      out.quality=false;
      if(base!=null) out.min = slot==="L" ? Math.min(out.min, round5(base*0.6)) : Math.min(out.min, 30);
      out.text = slot==="RACE" ? "Start, run-walk from the first kilometre, and be ready to walk it in." : easyText;
      out.reason = (out.reason ? out.reason+" " : "")+"Amber this morning: easy only, flat and soft. Stop and walk home if the pain climbs or anything reaches below the knee.";
    }
    if(out.quality && o.quiet<7){
      out.quality=false; out.text=easyText;
      out.reason=(out.reason ? out.reason+" " : "")+"Strides and steady work wait for 7 days without Amber or Red ("+o.quiet+" so far): run it easy.";
    }
    return out;
  }

  // Which of the runs still left to suggest for today. Mirrors Stine's tracker: with days
  // to spare, spend the easy runs first and keep the long run for the weekend; once the runs
  // left no longer fit the days left, name the long run, because that is the one that counts.
  function suggest(wk, assigned, today){
    var left=slotsOf(wk).filter(function(s){ return !assigned.done[s]; });
    if(!left.length) return null;
    if(left.indexOf("RACE")>=0) return today>=weekEnd(wk) ? "RACE" : (left.filter(function(s){return s!=="RACE";})[0]||"RACE");
    var daysLeft=7-dow(today);
    if(left.indexOf("L")>=0 && (dow(today)>=5 || left.length>=daysLeft)) return "L";
    return left.filter(function(s){ return s!=="L"; })[0] || "L";
  }

  function weekTotals(runs, wk){
    var inWeek=runs.filter(function(r){ return r.run_date>=wk.start && r.run_date<=weekEnd(wk); });
    var done=inWeek.reduce(function(a,r){ return a+Number(r.duration_min||0); }, 0);
    var plan=wk.E+wk.Q+(wk.L||0);
    return { done:Math.round(done), plan:plan, runs:inWeek.length };
  }

  // The gym deloads in the programme's own weeks (10, 18, 24); after week 24 it deloads in
  // the run plan's cutback and taper weeks instead, so the two never peak together.
  function gymDeload(rehabWeek, deloads, wk){
    if(deloads.indexOf(rehabWeek)>=0) return true;
    return rehabWeek>24 && !!wk && (wk.tag==="cutback" || wk.tag==="taper" || wk.tag==="race");
  }

  // Every exercise in the programme, once each (by app name), grouped by muscle group.
  // `phase` is read first, so an exercise that appears in several phases carries the dose
  // of the phase you are in. maxSpine (a flare stage's sp) drops anything that loads the
  // spine more than the stage allows.
  function exerciseCatalog(program, maxSpine, phase){
    var seen={}, groups=[], byG={};
    var order=["1","2","3"], p0=String(phase||"");
    if(order.indexOf(p0)>0){ order.splice(order.indexOf(p0),1); order.unshift(p0); }
    order.forEach(function(p){ ["A","B","C"].forEach(function(d){
      (program[p]&&program[p][d]||[]).forEach(function(e){
        if(seen[e.n]) return;
        if(maxSpine!=null && (e.sp||1)>maxSpine) return;
        seen[e.n]=true;
        var g=e.g||"other";
        if(!byG[g]){ byG[g]={g:g, items:[]}; groups.push(byG[g]); }
        byG[g].items.push(e);
      });
    }); });
    return groups;
  }

  // A day's exercise list with this session's swaps applied, BEFORE any flare-stage
  // rewriting, so the stage still filters and doses a swapped-in exercise. swaps =
  // {programmedName: newName}: keyed by name, not row, because a flare stage removes rows
  // and would shift every index after it. The new exercise brings its own programmed dose
  // (from `phase` where it appears there) and remembers what it replaced.
  function applySwaps(ex, swaps, program, phase){
    if(!swaps) return ex;
    var all={};
    exerciseCatalog(program, null, phase).forEach(function(g){ g.items.forEach(function(e){ all[e.n]=e; }); });
    return ex.map(function(e){
      var to=swaps[e.n]; if(to==null || !all[to] || to===e.n) return e;
      var c={}; for(var k in all[to]) c[k]=all[to][k];
      c.from=e.n;
      return c;
    });
  }

  return { dayNum:dayNum, addDays:addDays, weekOf:weekOf, weekEnd:weekEnd, daysBetween:daysBetween,
    dow:dow, slotText:slotText, slotsOf:slotsOf, assignWeek:assignWeek, quietDays:quietDays,
    prescribe:prescribe, suggest:suggest, weekTotals:weekTotals, gymDeload:gymDeload,
    exerciseCatalog:exerciseCatalog, applySwaps:applySwaps };
})();
if(typeof module!=="undefined") module.exports=RL;
